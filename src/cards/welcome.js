import calendar from "./calendar.cjs";
// 欢迎、今日台历与每日一句共用一张卡片。
const defaults={name:'',showClock:true,showSeconds:false,showMeta:true,source:'',mode:'daily',quotes:[]};
const builtinQuotes=['把注意力放在当下，把想法留给纸笔。','慢慢来，比较快。','日拱一卒，功不唐捐。','记录是为了更好地遗忘，也为了更好地记起。','先完成眼前这一件事。','给重要的事，留一点安静的时间。','今天也要好好生活。'];
export default {
 kind:'workspace-welcome',name:'欢迎与今日一句',icon:'sunrise',accent:'#6388c9',defaultSize:{w:12,h:4},defaultConfig:()=>({...defaults,quotes:[]}),
 async render(body,ctx){
  if(!ctx.isAlive())return;
  const config={...defaults,...ctx.config};body.addClass('ws-welcome');
  const top=body.createDiv({cls:'ws-welcome-top'}),left=top.createDiv({cls:'ws-welcome-left'});
  left.createDiv({text:'MY WORKSPACE',cls:'ws-welcome-eyebrow'});
  const greeting=left.createDiv({cls:'ws-welcome-greeting'});
  if(config.showMeta){const count=ctx.app.vault.getMarkdownFiles().length;left.createDiv({text:`${count.toLocaleString()} 篇笔记 · 专注当下，记录每一天`,cls:'ws-welcome-meta'});}
  const right=top.createDiv({cls:'ws-welcome-right'});
  const clockbox=right.createDiv({cls:'ws-welcome-clockbox'});
  const clock=config.showClock?clockbox.createDiv({cls:'ws-welcome-clock'}):null;
  const calendarHost=right.createDiv({cls:'ws-welcome-calendar'});
  const quote=body.createDiv({cls:'ws-welcome-quote'});quote.createSpan({text:'今日一句',cls:'ws-welcome-quote-label'});
  const sentence=quote.createSpan({cls:'ws-welcome-quote-text'});
  let quotes=Array.isArray(config.quotes)?config.quotes.filter(x=>typeof x==='string'&&x.trim()):[];
  const pick=d=>{
   const list=quotes.length?quotes:builtinQuotes;
   // 用本地年月日生成索引，跨设备同一天显示一致。
   const index=config.mode==='random'?Math.floor(Math.random()*list.length):Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000)%list.length;
   sentence.setText(list[index]);
  };
  let lastDay='';
  const update=()=>{
   const d=new Date(),h=d.getHours();const word=h<6?'夜深了':h<12?'上午好':h<14?'中午好':h<18?'下午好':'晚上好';
   greeting.setText(word+(config.name.trim()?'，'+config.name.trim():''));
   if(clock)clock.setText(d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',...(config.showSeconds?{second:'2-digit'}:{}),hour12:false}));
   const day=d.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
   if(day!==lastDay){lastDay=day;pick(d);}
  };
  update();ctx.registerInterval(update,config.showSeconds?1000:30000);
  try{
   calendar.render(calendarHost,ctx);
  }catch(e){
   if(ctx.isAlive())calendarHost.createSpan({cls:'ws-calendar-error',text:'台历加载失败，请重新加载首页'});
   console.error('工作台：加载台历失败',e);
  }
  if(config.source.trim()){
   const file=ctx.app.vault.getAbstractFileByPath(config.source.trim());
   if(file&&file.extension==='md'){
    try{
     const lines=(await ctx.app.vault.cachedRead(file)).split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')&&!x.startsWith('---')&&!x.startsWith('```')).map(x=>x.replace(/^\s*[-*+>]\s*/,''));
     if(ctx.isAlive()&&lines.length){quotes=lines;pick(new Date());}
    }catch(e){console.error('工作台：读取语录来源失败',e);}
   }
  }
 },
};
