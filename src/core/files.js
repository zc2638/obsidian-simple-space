import {normalizeDirectory,validateVaultPath} from './model.js';
import {parseTasks,taskFiles} from './tasks.js';
export async function ensureFolder(vault,folder){
 const clean=normalizeDirectory(folder);if(clean==='.')return;
 const parts=clean.split('/');
 for(let i=1;i<=parts.length;i++){
  const path=parts.slice(0,i).join('/'),existing=vault.getAbstractFileByPath(path);
  if(existing){if(!Array.isArray(existing.children))throw new Error(`${path} 是文件，不能作为目录`);continue;}
  try{await vault.createFolder(path);}catch(error){const current=vault.getAbstractFileByPath(path);if(!current||!Array.isArray(current.children))throw error;}
 }
}
export async function appendToNote(vault,path,text){
 validateVaultPath(path);if(!path.toLowerCase().endsWith('.md'))throw new Error('请选择 Markdown 笔记路径（.md）');
 const parent=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'.';await ensureFolder(vault,parent);
 let file=vault.getAbstractFileByPath(path);
 if(!file){try{return await vault.create(path,text);}catch(error){file=vault.getAbstractFileByPath(path);if(!file)throw error;}}
 if(Array.isArray(file.children))throw new Error('保存路径指向目录');
 await vault.process(file,current=>current+(current&&!current.endsWith('\n')?'\n':'')+text);return file;
}
export async function readTaskSource(vault,config){
 const files=taskFiles(vault.getMarkdownFiles(),config),result=[];
 for(const file of files)result.push(...parseTasks(await vault.read(file),file.path));
 return result;
}
