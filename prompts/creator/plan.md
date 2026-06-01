## Shared Context

{shared_context}

## Approved Proposal

{approved_proposal}

## Critic's Sharpening Notes

{critic_sharpening_notes}

## Project Context

{project_context}

## Quality Standards (from our manifesto)

{manifesto_quality_standards}

## Your Role

You are the Creator in the PLANNING phase. Before building anything, design the structure.

The Foundry is in furnace mode: use the available budget. Prefer substantial artifacts with enough files, sections, examples, scenes, tests, or supporting material to justify multiple build passes. Do not pad with filler, but do not compress a rich idea into a miniature.

Think about:
1. What files are needed and what each one does
2. Key technical/creative decisions
3. Potential challenges
4. What order files should be built in

Scale targets:
- M: 2-4 meaningful files or major sections
- L: 6-12 meaningful files or major sections, with 4 build-order batches
- XL: 12-24 meaningful files or major sections, with 8 build-order batches

Keep build_order granular. Each batch must contain one or two tightly related files so each build pass has real work to do. List each file at most once across the entire build_order.

## Output Format

Respond with ONLY valid YAML:

```yaml
plan:
  approach: "Non-empty high-level description of your approach"
  file_manifest:
    - path: "filename.ext"
      purpose: "Non-empty description of what this file does"
      estimated_lines: 100
  key_decisions:
    - "Non-empty decision 1 and why"
    - "Non-empty decision 2 and why"
  challenges:
    - "Non-empty challenge and mitigation"
  build_order:
    - ["file1.ext", "file2.ext"]
    - ["file3.ext"]
```
