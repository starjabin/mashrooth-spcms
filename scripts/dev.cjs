const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const staticFiles={'/':'web/index.html','/index.html':'web/index.html','/billing':'web/billing.html','/billing.js':'web/billing.js','/trial':'web/trial.html','/trial.js':'web/trial.js','/app':'web/app.html','/app/':'web/app.html','/app.html':'web/app.html','/signup':'web/signup.html','/signup/':'web/signup.html','/signup.html':'web/signup.html','/purchase-privacy':'web/purchase-privacy.html','/purchase-privacy/':'web/purchase-privacy.html','/purchase-privacy.html':'web/purchase-privacy.html','/app.js':'web/app.js','/landing.js':'web/landing.js','/signup.js':'web/signup.js','/styles.css':'web/styles.css','/landing.css':'web/landing.css','/signup.css':'web/signup.css','/schema.json':'web/schema.json','/logo-icon.png':'assets/logo-icon.png'};
const handlers={'/api/billing/checkout':'billing/[action]','/api/billing/portal':'billing/[action]','/api/billing/status':'billing/[action]','/api/billing/webhook':'billing/[action]','/api/session':'session','/api/health':'health','/api/records':'records','/api/overview':'overview','/api/audit':'audit','/api/parse':'parse','/api/ai/analyze':'ai/analyze','/api/admin/users':'admin/users','/api/sync':'sync','/api/purchase-requests':'purchase-requests'};
const headers=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).headers[0].headers;
http.createServer(async(req,res)=>{
  for(const h of headers)res.setHeader(h.key,h.value);
  const url=new URL(req.url,'http://localhost');
  if(handlers[url.pathname]){
    req.query=Object.fromEntries(url.searchParams);if(url.pathname.startsWith('/api/billing/'))req.query.action=url.pathname.split('/').at(-1);
    res.status=n=>{res.statusCode=n;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res;};
    let body='';try{for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4200000){res.status(413).json({error:'Request too large'});return;}}if(url.pathname==='/api/billing/webhook')req.rawBody=Buffer.from(body);else req.body=body?JSON.parse(body):undefined;}
    catch{res.status(400).json({error:'Invalid JSON'});return;}
    try{await require(path.join(root,'api',handlers[url.pathname]+'.js'))(req,res);}catch{if(!res.writableEnded)res.status(500).json({error:'Internal server error'});}return;
  }
  const file=staticFiles[url.pathname];if(!file){res.statusCode=404;res.end('Not found');return;}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
  res.setHeader('Content-Type',types[path.extname(file)]);res.setHeader('Cache-Control','no-store');fs.createReadStream(path.join(root,file)).pipe(res);
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Mashrooth local server: http://localhost:'+ (process.env.PORT||3000)));
