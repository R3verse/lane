(function(){
  const allowed=['client','version','reachable','receiving','https','secureContext','paired','screenWakeLock','latencyMs'];
  const labels={client:'Client',version:'Lane version',reachable:'Receiver reachable',receiving:'Receiving enabled',https:'HTTPS available / in use',secureContext:'Secure browser context',paired:'Paired device available',screenWakeLock:'Browser wake-lock support',latencyMs:'Response time (ms)'};
  function sanitize(input){
    const report={};
    for(const key of allowed){
      const value=input[key];
      if(typeof value==='boolean')report[key]=value;
      else if(key==='client' && ['Windows','Browser'].includes(value))report[key]=value;
      else if(key==='version' && /^\d+\.\d+\.\d+$/.test(value))report[key]=value;
      else if(key==='latencyMs' && Number.isFinite(value))report[key]=Math.max(0,Math.round(value));
    }
    return report;
  }
  if(typeof module!=='undefined' && module.exports){module.exports={sanitize};return;}
  function mount(root,options){
    root.innerHTML='<h3>Connection check</h3><p>Check this client’s connection to Lane. The report contains only capability flags, version and response time—no names, addresses, keys, messages or file details.</p><button type="button" class="button secondary connection-run">Run connection check</button><dl class="connection-results"></dl><p class="connection-feedback" role="status"></p><details class="connection-report" hidden><summary>Preview diagnostic report</summary><pre></pre><button type="button" class="button secondary connection-save">Save report</button></details><p class="subtext">A secure context cannot prove that a certificate warning was not bypassed. Verify the certificate first. Keep Lane open on both devices; locking a phone can interrupt its transfers.</p>';
    let report;
    root.querySelector('.connection-run').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      const feedback=root.querySelector('.connection-feedback');feedback.textContent='Checking…';
      try{report=sanitize(await options.check());}catch{report=sanitize({client:options.client,reachable:false});}
      const list=root.querySelector('.connection-results');list.replaceChildren();
      for(const [key,value] of Object.entries(report)){const row=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=labels[key];description.textContent=typeof value==='boolean' ? value ? 'Yes' : 'No' : String(value);row.append(term,description);list.append(row);}
      feedback.textContent=!report.reachable ? 'Cannot reach Lane. Keep the computer running and check that both devices use the same network.' : !report.receiving ? 'Connected. Receiving is paused in the computer’s Settings.' : 'Receiver is responding. Try a small file to verify your complete sending workflow.';
      root.querySelector('pre').textContent=JSON.stringify(report,null,2);root.querySelector('.connection-report').hidden=false;button.disabled=false;
    });
    root.querySelector('.connection-save').addEventListener('click',async()=>{
      if(!report)return;const text=JSON.stringify(report,null,2);
      try{
        if(options.save)await options.save(text);
        else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='Lane-diagnostics.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
      }catch{root.querySelector('.connection-feedback').textContent='Could not save the report. You can copy the preview above.';}
    });
  }
  window.LaneConnection={mount};
})();
