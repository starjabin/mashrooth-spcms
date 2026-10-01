const status=document.querySelector('#status'),message=document.querySelector('#message');
async function call(path,body){let r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(r.status===401){const refresh=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh'})});if(!refresh.ok){location.assign('/app');throw new Error('Sign in to manage billing');}r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
 const d=await r.json();if(!r.ok)throw new Error(d.error||'Billing unavailable');return d;}
async function load(){try{const b=await call('/api/billing/status');status.textContent=`${b.plan||'No plan'} · ${b.status} · ${b.entitled?'Access available':'Subscription required'}`+(b.status==='trialing'?` · Trial ends ${new Date(b.trialEndsAt).toLocaleString()}`:b.periodEnd?` · Period ends ${new Date(b.periodEnd).toLocaleString()}`:'');
 for(const btn of document.querySelectorAll('[data-tier]'))btn.disabled=!b.canManage||!['trialing','canceled','incomplete_expired','missing'].includes(b.status);
 document.querySelector('#portal').disabled=!b.canManage||!b.hasCustomer;
 if(new URLSearchParams(location.search).get('checkout')==='success')message.textContent=b.status==='active'?'Payment confirmed. Open your workspace.':'Waiting for Stripe confirmation. Refresh status shortly. The return URL does not activate access.';
 }catch(e){message.textContent=e.message;}}
async function redirect(path,body,btn){btn.disabled=true;try{const d=await call(path,body);const url=new URL(d.url);if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw new Error('Unexpected billing destination');location.assign(url.href);}catch(e){message.textContent=e.message;btn.disabled=false;}}
for(const btn of document.querySelectorAll('[data-tier]'))btn.onclick=()=>redirect('/api/billing/checkout',{tier:btn.dataset.tier},btn);
document.querySelector('#portal').onclick=e=>redirect('/api/billing/portal',{},e.target);
document.querySelector('#refresh').onclick=load;
await load();
