import captureFiles from './capture-files.cjs';

export const TASK_HEADER='# 待办任务\n\n';

export function taskStorageConfig(config={}){
 const notePath=config.inboxPath??'Simple Space/待办任务/待办任务.md';
 const parent=notePath.includes('/')?notePath.slice(0,notePath.lastIndexOf('/')):'.';
 const noteFolder=config.noteFolder??parent;
 return captureFiles.normalizeCaptureConfig({saveMode:config.saveMode??'single',noteFolder,notePath,
  attachmentFolder:(noteFolder==='.'?'':noteFolder+'/')+'附件',splitBySize:config.splitBySize??true,maxFileSizeKB:config.maxFileSizeKB??1024});
}

export function formatTaskEntry({text='',links=[],markers=''}){
 const lines=text.trim().split(/\r?\n/),title=lines.shift()||'附件待办';
 const details=[...lines,...links].map(line=>'  '+line).join('\n');
 return '\n'+(markers?markers+'\n':'')+'- [ ] '+title+'\n'+(details?details+'\n':'');
}
