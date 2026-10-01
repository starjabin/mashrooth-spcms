// The maintained frontend is plain browser-module source; no compiled legacy bundle is shipped.
const fs=require('node:fs');
fs.rmSync('dist',{recursive:true,force:true});
fs.mkdirSync('dist');
for(const file of ['billing.html','billing.js','trial.html','trial.js','index.html','app.html','signup.html','purchase-privacy.html','app.js','landing.js','signup.js','styles.css','landing.css','signup.css','schema.json']) fs.copyFileSync('web/'+file, 'dist/'+file);
fs.copyFileSync('assets/logo-icon.png','dist/logo-icon.png');
fs.writeFileSync('dist/robots.txt','User-agent: *\nDisallow: /\n');
console.log('Source frontend built in dist/. API source remains under api/.');
