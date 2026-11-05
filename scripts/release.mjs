import {readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

function run(program,args,options={}){
 return execFileSync(program,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,...options})?.trim();
}
function requireValue(condition,message){if(!condition)throw new Error(message);}
function json(file){return JSON.parse(readFileSync(file,'utf8'));}
function clean(){requireValue(!run('git',['status','--porcelain','--untracked-files=normal']),'工作区有未提交的修改，请先提交本次发布内容。');}
function remoteTag(version){
 const refs=run('git',['ls-remote','origin',`refs/tags/${version}`,`refs/tags/${version}^{}`]).split('\n').filter(Boolean).map(line=>line.split(/\s+/));
 return refs.find(([,ref])=>ref.endsWith('^{}'))?.[0]||refs[0]?.[0];
}

try{
 const args=process.argv.slice(2);
 requireValue(args.every(arg=>['--check','--draft'].includes(arg)),'用法：node scripts/release.mjs [--check] [--draft]');
 const manifest=json('manifest.json'),pkg=json('package.json'),lock=json('package-lock.json'),versions=json('versions.json');
 const {id,name,version,minAppVersion}=manifest;
 requireValue(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id),'manifest.json 中的插件 ID 无效。');
 requireValue(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),'manifest.json 的版本必须为 x.y.z，不带 v 前缀。');
 requireValue(pkg.version===version,'package.json 与 manifest.json 版本不一致。');
 requireValue(lock.version===version&&lock.packages?.['']?.version===version,'package-lock.json 与 manifest.json 版本不一致。');
 requireValue(versions[version]===minAppVersion,'versions.json 缺少当前版本或最低 Obsidian 版本不一致。');
 let commit;
 try{commit=run('git',['rev-parse','--verify','HEAD']);}catch{throw new Error('仓库尚无提交，请先提交源码并推送到 GitHub。');}
 clean();
 let remote;
 try{remote=run('git',['config','--get','remote.origin.url']);}catch{throw new Error('尚未配置 origin，请先关联 GitHub 仓库并推送源码。');}
 const match=remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
 requireValue(match,'origin 必须是 github.com 上的 HTTPS 或 SSH 仓库地址。');
 const repository=match[1],branch=run('git',['branch','--show-current']);
 requireValue(branch,'当前处于 detached HEAD，请切回已推送的发布分支。');
 const remoteCommit=run('git',['ls-remote','origin',`refs/heads/${branch}`]).split(/\s+/)[0];
 requireValue(remoteCommit===commit,`当前 ${branch} 分支尚未完整推送，请先 git push -u origin ${branch}。`);
 const tagCommit=remoteTag(version);
 requireValue(!tagCommit||tagCommit===commit,`远端标签 ${version} 已指向其他提交，请递增版本，不覆盖旧标签。`);
 try{run('gh',['auth','status','--active','--hostname','github.com'],{stdio:'ignore'});}catch{throw new Error('GitHub CLI 不可用或未登录，请安装 gh 并执行 gh auth login。');}
 const assets=['main.js','manifest.json','styles.css'].map(file=>path.resolve('dist',id,file));
 assets.push(path.resolve('dist',`${id}-${version}.zip`));
 console.log(`目标：${repository}\n版本／标签：${version}\n提交：${commit}\n模式：${args.includes('--draft')?'Release 草稿':'正式 Release'}\n附件：\n${assets.map(file=>'  '+file).join('\n')}`);
 if(args.includes('--check'))console.log('预检通过；未运行构建、未推送标签、未创建 Release。');
 else{
  run('npm',['test'],{stdio:'inherit'});
  run('npm',['run','package'],{stdio:'inherit'});
  run(process.execPath,['--check','main.js'],{stdio:'inherit'});
  for(const file of assets)requireValue(statSync(file).isFile()&&statSync(file).size>0,`发布附件为空：${file}`);
  for(const file of ['main.js','manifest.json','styles.css'])requireValue(readFileSync(file).equals(readFileSync(path.join('dist',id,file))),`打包文件与构建不一致：${file}`);
  // 耗时测试后再次确认发布内容，防止中途改动源码或切换提交。
  clean();requireValue(run('git',['rev-parse','HEAD'])===commit,'验证期间 HEAD 已改变，请重新发布。');
  if(!tagCommit)run('git',['push','origin',`${commit}:refs/tags/${version}`],{stdio:'inherit'});
  const releaseArgs=['release','create',version,...assets,'--repo',repository,'--verify-tag','--title',`${name} ${version}`,'--generate-notes'];
  if(args.includes('--draft'))releaseArgs.push('--draft');
  run('gh',releaseArgs,{stdio:'inherit'});
  console.log(args.includes('--draft')?'Release 草稿已创建，确认内容后可在 GitHub 发布。':'GitHub Release 已发布。');
 }
}catch(error){
 console.error('发布失败：'+error.message);
 process.exitCode=1;
}
