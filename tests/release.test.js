import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

const script=path.resolve('scripts/release.mjs');
function fixture(t,options={}){
 const root=mkdtempSync(path.join(tmpdir(),'simple-space-release-')),repo=path.join(root,'repo'),remote=path.join(root,'remote.git'),bin=path.join(root,'bin'),log=path.join(root,'gh.jsonl');
 t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(repo);mkdirSync(bin);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 execFileSync('git',['init','--bare',remote],{stdio:'ignore'});git('init','-b','main');git('config','user.email','test@example.invalid');git('config','user.name','Release Test');
 git('config',`url.file://${remote}.insteadOf`,'https://github.com/test/simple-space.git');git('remote','add','origin','https://github.com/test/simple-space.git');
 const manifest={id:'simple-space',name:'Simple Space',version:'0.1.0',minAppVersion:'1.8.7',description:'Create a customizable workspace with tasks and quick capture.'};
 writeFileSync(path.join(repo,'manifest.json'),JSON.stringify(manifest));
 writeFileSync(path.join(repo,'versions.json'),JSON.stringify({'0.1.0':'1.8.7'}));
 writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'simple-space',version:'0.1.0',scripts:{test:'node -e "process.exit(0)"',package:'node package.cjs'}}));
 writeFileSync(path.join(repo,'package-lock.json'),JSON.stringify({version:'0.1.0',packages:{'':{version:'0.1.0'}}}));
 writeFileSync(path.join(repo,'.gitignore'),'dist/\nmain.js\n');
 writeFileSync(path.join(repo,'styles.css'),'/* fixture */');
 writeFileSync(path.join(repo,'package.cjs'),`const fs=require('node:fs');fs.mkdirSync('dist/simple-space',{recursive:true});fs.writeFileSync('main.js','module.exports={}');for(const name of ['main.js','manifest.json','styles.css'])fs.copyFileSync(name,'dist/simple-space/'+name);fs.writeFileSync('dist/simple-space-0.1.0.zip','fixture zip');`);
 const fake=path.join(bin,'gh');writeFileSync(fake,`#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');const unsupported=args.find(arg=>['--active','--verify-tag'].includes(arg));if(unsupported){console.error('unknown flag: '+unsupported);process.exit(1);}if(args[0]==='auth'&&${JSON.stringify(Boolean(options.authFailure))}){console.error('HTTP 502: Bad Gateway');process.exit(1);}if(args[0]==='release'&&args[1]==='create')console.log('https://github.com/test/simple-space/releases/tag/0.1.0');\n`);chmodSync(fake,0o755);
 git('add','.');git('commit','-m','feat: initial plugin');git('push','-u','origin','main');
 const invoke=(...args)=>spawnSync(process.execPath,[script,...args],{cwd:repo,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH},encoding:'utf8'});
 const calls=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
 return {repo,git,invoke,calls};
}

test('旧版gh发布预检只展示计划，不打包、不推送标签、不创建Release',t=>{
 const f=fixture(t),r=f.invoke('--check');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/0\.1\.0/);assert.match(r.stdout,/main\.js/);assert.equal(f.git('ls-remote','origin','refs/tags/0.1.0'),'');assert.equal(existsSync(path.join(f.repo,'dist')),false);assert.equal(f.calls().some(args=>args[0]==='release'),false);
});
test('正式发布只上传三个程序文件，ZIP留在本地，标签指向已推送的HEAD',t=>{
 const f=fixture(t),r=f.invoke();assert.equal(r.status,0,r.stderr);const args=f.calls().find(args=>args[0]==='release'&&args[1]==='create');assert.ok(args);assert.equal(args[2],'0.1.0');assert.equal(args.includes('--verify-tag'),false);assert.equal(args[args.indexOf('--target')+1],f.git('rev-parse','HEAD'));assert.ok(args.includes('--repo'));assert.ok(args.includes('test/simple-space'));assert.equal(args.includes('--draft'),false);
 for(const name of ['main.js','manifest.json','styles.css'])assert.ok(args.some(arg=>arg.endsWith('/dist/simple-space/'+name)),name);
 assert.equal(args.some(arg=>arg.endsWith('.zip')),false);assert.ok(existsSync(path.join(f.repo,'dist/simple-space-0.1.0.zip')));assert.equal(f.git('ls-remote','origin','refs/tags/0.1.0').split(/\s/)[0],f.git('rev-parse','HEAD'));
});
test('草稿发布明确传递draft参数，已存在的同提交标签允许重试',t=>{
 const f=fixture(t);f.git('push','origin','HEAD:refs/tags/0.1.0');const r=f.invoke('--draft');assert.equal(r.status,0,r.stderr);assert.ok(f.calls().find(args=>args[0]==='release').includes('--draft'));
});
test('未提交修改与未推送提交均拒绝发布，不生成远端标签',t=>{
 const f=fixture(t);writeFileSync(path.join(f.repo,'pending.md'),'未提交');let r=f.invoke();assert.notEqual(r.status,0);assert.match(r.stderr,/未提交/);rmSync(path.join(f.repo,'pending.md'));writeFileSync(path.join(f.repo,'styles.css'),'/* changed */');f.git('add','.');f.git('commit','-m','fix: style');r=f.invoke();assert.notEqual(r.status,0);assert.match(r.stderr,/推送/);assert.equal(f.git('ls-remote','origin','refs/tags/0.1.0'),'');assert.equal(f.calls().some(args=>args[0]==='release'),false);
});
test('版本元数据不一致时拒绝发布',t=>{
 const f=fixture(t);writeFileSync(path.join(f.repo,'versions.json'),'{}');f.git('add','.');f.git('commit','-m','test: mismatch');f.git('push');const r=f.invoke();assert.notEqual(r.status,0);assert.match(r.stderr,/versions\.json/);assert.equal(f.calls().length,0);
});
test('远端同名标签指向其他提交时拒绝覆盖',t=>{
 const f=fixture(t);f.git('push','origin','HEAD:refs/tags/0.1.0');writeFileSync(path.join(f.repo,'styles.css'),'/* next */');f.git('add','.');f.git('commit','-m','fix: next');f.git('push');const r=f.invoke();assert.notEqual(r.status,0);assert.match(r.stderr,/标签/);assert.equal(f.calls().some(args=>args[0]==='release'),false);
});
test('测试失败时不推送标签或创建Release',t=>{
 const f=fixture(t),p=path.join(f.repo,'package.json'),pkg=JSON.parse(readFileSync(p));pkg.scripts.test='node -e "process.exit(1)"';writeFileSync(p,JSON.stringify(pkg));f.git('add','.');f.git('commit','-m','test: failing suite');f.git('push');const r=f.invoke();assert.notEqual(r.status,0);assert.equal(f.git('ls-remote','origin','refs/tags/0.1.0'),'');assert.equal(f.calls().some(args=>args[0]==='release'),false);
});
test('登录检查异常不误报未登录，提示可独立诊断的兼容命令',t=>{
 const f=fixture(t,{authFailure:true}),r=f.invoke('--check');assert.notEqual(r.status,0);assert.match(r.stderr,/GitHub 登录检查失败/);assert.match(r.stderr,/gh auth status --hostname github\.com/);assert.doesNotMatch(r.stderr,/不可用或未登录/);assert.equal(f.calls().some(args=>args[0]==='release'),false);
});
test('市场描述不合规时在任何Git或发布操作之前拒绝，避免重复上架错误',t=>{
 const f=fixture(t),p=path.join(f.repo,'manifest.json'),manifest=JSON.parse(readFileSync(p));
 for(const description of ['An Obsidian workspace.','一个工作台。','x'.repeat(251)+'.','']){
  writeFileSync(p,JSON.stringify({...manifest,description}));const r=f.invoke('--check');assert.notEqual(r.status,0);assert.match(r.stderr,/插件描述/);assert.equal(f.calls().length,0);
 }
});
