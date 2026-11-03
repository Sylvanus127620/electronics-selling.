export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, '');
  const password = request.headers.get('x-admin-password') || (request.method === 'POST' && path === 'login' ? (await request.clone().json().catch(()=>({}))).password : '');
  if (!env.ADMIN_PASSWORD || !env.GITHUB_TOKEN) return new Response('Cloudflare secrets are not configured', {status:503});
  if (password !== env.ADMIN_PASSWORD) return new Response('Unauthorized', {status:401});
  if (path === 'login') return Response.json({ok:true});
  if (path !== 'github') return new Response('Not found',{status:404});
  const target = url.searchParams.get('path') || '';
  if (!target.startsWith('/repos/') || target.includes('..')) return new Response('Invalid GitHub API path',{status:400});
  const upstream = await fetch('https://api.github.com' + target, {
    method: request.method,
    headers: {'Authorization': `Bearer ${env.GITHUB_TOKEN}`, 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':'application/json', 'User-Agent':'ElectronicsSellingAdmin'},
    body: ['GET','HEAD'].includes(request.method) ? undefined : await request.text()
  });
  return new Response(await upstream.text(), {status:upstream.status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
