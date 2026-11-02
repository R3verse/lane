function deviceProfile(req) {
  const ua=String(req.headers['user-agent'] || '').slice(0,1000);
  const tablet=/iPad/.test(ua) || /Macintosh/.test(ua) && req.headers['x-lane-tablet']==='1' || /Android/.test(ua) && !/Mobile/.test(ua);
  const platform=/iPhone|iPad/.test(ua) || /Macintosh/.test(ua) && tablet ? 'iOS / iPadOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown system';
  return {kind:tablet ? 'tablet' : /iPhone|Mobile/.test(ua) ? 'phone' : /Windows|Macintosh|Linux/.test(ua) ? 'computer' : 'browser',platform,browser:/Edg/.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser'};
}
module.exports={deviceProfile};
