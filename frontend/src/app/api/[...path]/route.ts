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

  const body = method !== 'GET' && method !== 'DELETE' ? await request.text() : undefined;
  const headers = new Headers(request.headers);
  headers.delete('host'); // Remove host header to prevent issues

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
    });

    // Copy response headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('access-control-allow-origin', '*');

    return new Response(await response.text(), {
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
