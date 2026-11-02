const path=require('node:path');
function launchRequest(argv) {
  const action=argv.find(arg=>/^--lane-action=(messages|send|pair)$/.test(arg))?.split('=')[1];
  const index=argv.indexOf('--lane-send');
  const files=index>=0 ? argv.slice(index+1).filter(file=>path.isAbsolute(file) && !file.startsWith('--')).slice(0,100) : [];
  return files.length ? {action:'send',files} : action ? {action} : null;
}
module.exports={launchRequest};
