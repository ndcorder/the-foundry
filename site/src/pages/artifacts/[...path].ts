import fs from 'node:fs/promises';
import path from 'node:path';

import { getArtifactAssetFiles } from '@lib/portfolio';

interface ArtifactAssetProps {
  sourcePath: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function getStaticPaths(): Array<{ params: { path: string }; props: ArtifactAssetProps }> {
  return getArtifactAssetFiles().map(file => ({
    params: { path: file.routePath },
    props: { sourcePath: file.sourcePath },
  }));
}

export async function GET({ props }: { props: ArtifactAssetProps }): Promise<Response> {
  const body = await fs.readFile(props.sourcePath);
  return new Response(body, {
    headers: {
      'Content-Type': contentTypeFor(props.sourcePath),
    },
  });
}
