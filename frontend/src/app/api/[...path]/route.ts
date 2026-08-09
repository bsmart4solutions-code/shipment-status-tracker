/**
 * Proxy all /api/* requests to the NestJS backend.
 * This works around issues with Next.js rewrites in dev mode.
 */
export async function POST(request: Request, { params }: { params: { path: string[] } }) {
  return proxyRequest('POST', params.path, request);
}

export async function GET(request: Request, { params }: { params: { path: string[] } }) {
  return proxyRequest('GET', params.path, request);
}

export async function PATCH(request: Request, { params }: { params: { path: string[] } }) {
  return proxyRequest('PATCH', params.path, request);
}

export async function PUT(request: Request, { params }: { params: { path: string[] } }) {
  return proxyRequest('PUT', params.path, request);
}

export async function DELETE(request: Request, { params }: { params: { path: string[] } }) {
  return proxyRequest('DELETE', params.path, request);
}

async function proxyRequest(method: string, path: string[], request: Request) {
  const backendUrl = process.env.API_URL || 'http://localhost:4000';
  const pathStr = path.join('/');
  const url = new URL(`/api/${pathStr}`, backendUrl);

  // Preserve query params
  const searchParams = new URL(request.url).searchParams;
  for (const [key, value] of searchParams) {
    url.searchParams.append(key, value);
  }

  // arrayBuffer, NOT text: `.text()` decodes the body as UTF-8, which replaces
  // every byte sequence that is not valid UTF-8 — so a PDF or an image inside a
  // multipart upload arrives corrupted AND a different length than the
  // Content-Length header we forward, leaving the backend waiting for bytes
  // that never come. Every file upload through the browser timed out at 408
  // because of this line.
  const body = method !== 'GET' && method !== 'DELETE' ? await request.arrayBuffer() : undefined;
  const headers = new Headers(request.headers);
  headers.delete('host'); // Remove host header to prevent issues
  // Let fetch compute it from the body we actually send.
  headers.delete('content-length');

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
    });

    // Copy response headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('access-control-allow-origin', '*');
    // fetch has already decompressed the body, so passing the original
    // content-encoding through would tell the browser to decompress it again.
    // Length is recomputed for the same reason.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    // Same reasoning as the request body, in reverse: a downloaded PDF or image
    // must not be round-tripped through a UTF-8 string.
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`Proxy error for ${method} ${url}:`, error);
    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
}
