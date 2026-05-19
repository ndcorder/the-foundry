import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { setRootDir } from '../src/root.js';
import {
  generateProjectId,
  createProject,
  getActiveProjects,
  countActiveProjects,
  getProjectContext,
  updateProjectStatus,
  linkArtifactToProject,
  updateProjectsIndex,
} from '../src/files/projects.js';
import type { ProjectBrief, ProjectStatus } from '../src/types/index.js';

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
  mkdirSync(path.join(tempDir, 'portfolio', 'projects'), { recursive: true });
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

const sampleBrief: ProjectBrief = {
  name: 'Test Project',
  description: 'A test project for unit testing',
  estimated_iterations: 5,
  structure: [
    { 'iteration-1': 'Setup and scaffolding' },
    { 'iteration-2': 'Core implementation' },
  ],
};

describe('generateProjectId', () => {
  it('returns P001 when no index exists', async () => {
    expect(await generateProjectId()).toBe('P001');
  });

  it('returns next id from existing index', async () => {
    const index = [
      '| ID | Name | Status | Progress | Started | Updated |',
      '|---|---|---|---|---|---|',
      '| P001 | First | active | 0/5 | 2026-01-01 | 2026-01-01 |',
      '| P002 | Second | complete | 5/5 | 2026-01-01 | 2026-01-10 |',
    ].join('\n');
    writeFileSync(path.join(tempDir, 'portfolio', 'projects', 'index.md'), index);
    expect(await generateProjectId()).toBe('P003');
  });
});

describe('createProject', () => {
  it('creates project directory with brief.md and status.yml', async () => {
    const projectId = await createProject(sampleBrief, 1);
    expect(projectId).toBe('P001');

    const projDir = path.join(tempDir, 'portfolio', 'projects', 'P001-test-project');
    expect(existsSync(projDir)).toBe(true);

    // Check brief.md
    const brief = readFileSync(path.join(projDir, 'brief.md'), 'utf-8');
    expect(brief).toContain('# Test Project');
    expect(brief).toContain('A test project for unit testing');
    expect(brief).toContain('iteration-1');

    // Check status.yml
    const statusRaw = readFileSync(path.join(projDir, 'status.yml'), 'utf-8');
    const status: ProjectStatus = yaml.parse(statusRaw);
    expect(status.project_id).toBe('P001');
    expect(status.name).toBe('Test Project');
    expect(status.status).toBe('active');
    expect(status.estimated_iterations).toBe(5);
    expect(status.completed_iterations).toBe(0);
    expect(status.last_iteration).toBe(1);
  });

  it('creates artifacts subdirectory', async () => {
    const projectId = await createProject(sampleBrief, 1);
    const artifactsDir = path.join(tempDir, 'portfolio', 'projects', `${projectId}-test-project`, 'artifacts');
    expect(existsSync(artifactsDir)).toBe(true);
  });

  it('updates the projects index', async () => {
    await createProject(sampleBrief, 1);
    const indexContent = readFileSync(path.join(tempDir, 'portfolio', 'projects', 'index.md'), 'utf-8');
    expect(indexContent).toContain('P001');
    expect(indexContent).toContain('Test Project');
    expect(indexContent).toContain('active');
  });
});

describe('getActiveProjects', () => {
  it('returns empty when projects dir does not exist', async () => {
    // Remove the projects directory entirely to trigger the readdir catch
    rmSync(path.join(tempDir, 'portfolio', 'projects'), { recursive: true, force: true });
    expect(await getActiveProjects()).toEqual([]);
  });

  it('returns empty when no projects exist', async () => {
    expect(await getActiveProjects()).toEqual([]);
  });

  it('returns only active projects', async () => {
    // Create an active project
    await createProject(sampleBrief, 1);

    // Create a completed project manually
    const completeDir = path.join(tempDir, 'portfolio', 'projects', 'P002-done-proj');
    mkdirSync(completeDir, { recursive: true });
    const completeStatus: ProjectStatus = {
      project_id: 'P002',
      name: 'Done Project',
      status: 'complete',
      estimated_iterations: 3,
      completed_iterations: 3,
      last_iteration: 5,
      created_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-05T00:00:00Z',
    };
    writeFileSync(path.join(completeDir, 'status.yml'), yaml.stringify(completeStatus));

    const active = await getActiveProjects();
    expect(active).toHaveLength(1);
    expect(active[0].project_id).toBe('P001');
  });

  it('skips project dirs with missing or corrupt status.yml', async () => {
    // Create a project dir matching P\d{3}- pattern but with no status.yml
    const badDir = path.join(tempDir, 'portfolio', 'projects', 'P001-broken-proj');
    mkdirSync(badDir, { recursive: true });
    // No status.yml written — readStatus should return null, getAllProjects skips it
    const active = await getActiveProjects();
    expect(active).toEqual([]);
  });
});

describe('countActiveProjects', () => {
  it('returns 0 when no projects', async () => {
    expect(await countActiveProjects()).toBe(0);
  });

  it('returns count of active projects', async () => {
    await createProject(sampleBrief, 1);
    await createProject({ ...sampleBrief, name: 'Second Project' }, 2);
    expect(await countActiveProjects()).toBe(2);
  });
});

describe('getProjectContext', () => {
  it('returns empty string for nonexistent project', async () => {
    expect(await getProjectContext('P999')).toBe('');
  });

  it('returns brief and artifact contents', async () => {
    const projectId = await createProject(sampleBrief, 1);
    const projDir = path.join(tempDir, 'portfolio', 'projects', `${projectId}-test-project`);
    writeFileSync(path.join(projDir, 'artifacts', 'art1.md'), 'Artifact 1 content');

    const ctx = await getProjectContext(projectId);
    expect(ctx).toContain('Test Project');
    expect(ctx).toContain('Artifact 1 content');
  });

  it('handles missing brief.md gracefully', async () => {
    const projectId = await createProject(sampleBrief, 1);
    const projDir = path.join(tempDir, 'portfolio', 'projects', `${projectId}-test-project`);
    rmSync(path.join(projDir, 'brief.md'));
    const ctx = await getProjectContext(projectId);
    expect(ctx).toBeDefined();
  });

  it('handles missing artifacts dir gracefully', async () => {
    const projectId = await createProject(sampleBrief, 1);
    const projDir = path.join(tempDir, 'portfolio', 'projects', `${projectId}-test-project`);
    rmSync(path.join(projDir, 'artifacts'), { recursive: true, force: true });
    const ctx = await getProjectContext(projectId);
    expect(ctx).toContain('Test Project');
  });
});

describe('updateProjectStatus', () => {
  it('updates fields in status.yml', async () => {
    const projectId = await createProject(sampleBrief, 1);
    await updateProjectStatus(projectId, { completed_iterations: 3, last_iteration: 10 });

    const projDir = path.join(tempDir, 'portfolio', 'projects', `${projectId}-test-project`);
    const status: ProjectStatus = yaml.parse(readFileSync(path.join(projDir, 'status.yml'), 'utf-8'));
    expect(status.completed_iterations).toBe(3);
    expect(status.last_iteration).toBe(10);
    expect(status.name).toBe('Test Project'); // unchanged
  });

  it('throws for nonexistent project', async () => {
    await expect(updateProjectStatus('P999', {})).rejects.toThrow('P999 not found');
  });

  it('throws when status.yml is missing', async () => {
    const badDir = path.join(tempDir, 'portfolio', 'projects', 'P099-bad-proj');
    mkdirSync(badDir, { recursive: true });
    // Dir exists but no status.yml — readStatus returns null
    await expect(updateProjectStatus('P099', {})).rejects.toThrow('Cannot read status');
  });

  it('throws when projects dir does not exist', async () => {
    rmSync(path.join(tempDir, 'portfolio', 'projects'), { recursive: true, force: true });
    // findProjectDir will catch readdir error and return null
    await expect(updateProjectStatus('P001', {})).rejects.toThrow('P001 not found');
  });
});

describe('linkArtifactToProject', () => {
  it('creates artifact link file', async () => {
    const projectId = await createProject(sampleBrief, 1);
    await linkArtifactToProject(projectId, '0042', 'My Artifact');

    const projDir = path.join(tempDir, 'portfolio', 'projects', `${projectId}-test-project`);
    const linkFile = path.join(projDir, 'artifacts', '0042-my-artifact.md');
    expect(existsSync(linkFile)).toBe(true);
    const content = readFileSync(linkFile, 'utf-8');
    expect(content).toContain('My Artifact');
    expect(content).toContain('0042');
    expect(content).toContain(projectId);
  });

  it('throws for nonexistent project', async () => {
    await expect(linkArtifactToProject('P999', '0001', 'title')).rejects.toThrow('P999 not found');
  });
});

describe('updateProjectsIndex', () => {
  it('writes a formatted index file', async () => {
    const projects: ProjectStatus[] = [
      {
        project_id: 'P001',
        name: 'Alpha',
        status: 'active',
        estimated_iterations: 5,
        completed_iterations: 2,
        last_iteration: 10,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    await updateProjectsIndex(projects);
    const content = readFileSync(path.join(tempDir, 'portfolio', 'projects', 'index.md'), 'utf-8');
    expect(content).toContain('Projects Index');
    expect(content).toContain('P001');
    expect(content).toContain('Alpha');
    expect(content).toContain('2/5');
  });

  it('shows empty message for no projects', async () => {
    await updateProjectsIndex([]);
    const content = readFileSync(path.join(tempDir, 'portfolio', 'projects', 'index.md'), 'utf-8');
    expect(content).toContain('*No active projects.*');
  });
});
