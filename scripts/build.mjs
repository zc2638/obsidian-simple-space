import * as esbuild from 'esbuild';
const options={entryPoints:['src/main.js'],bundle:true,external:['obsidian'],format:'cjs',target:'es2020',platform:'browser',outfile:'main.js',logLevel:'info',sourcemap:false};
if(process.argv.includes('--watch')){const ctx=await esbuild.context(options);await ctx.watch();}else await esbuild.build(options);
