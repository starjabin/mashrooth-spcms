const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]);}
for(const file of [...walk('api'),...walk('lib'),...walk('scripts')].filter(x=>/\.[cm]?js$/.test(x))){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
const frontend=spawnSync(process.execPath,['--input-type=module','--check'],{input:fs.readFileSync('web/app.js','utf8'),encoding:'utf8'});
if(frontend.status!==0){console.error(frontend.stderr);process.exit(1);}
JSON.parse(fs.readFileSync('web/schema.json','utf8'));
console.log('JavaScript syntax checks passed.');
