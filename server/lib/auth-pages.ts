// Minimal SENTRIX-themed sign-in page (dark theme). Talks to /api/auth/* JSON endpoints.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export function loginPageHtml(opts: { signupEnabled: boolean }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · SENTRIX</title><style>
:root{color-scheme:dark;--bg:#09090b;--panel:#141417;--line:#27272a;--fg:#fafafa;--mut:#a1a1aa;--acc:#8b5cf6}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{width:min(400px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--mut);margin:0 0 18px}label{display:block;font-size:13px;margin:12px 0 4px}
input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:#0c0c0f;color:var(--fg);font:inherit}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
button.primary{width:100%;margin-top:18px;padding:10px;border:0;border-radius:8px;background:var(--acc);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.primary[disabled]{opacity:.6;cursor:wait}.links{display:flex;gap:14px;justify-content:space-between;margin-top:14px;font-size:13px}
.links button{background:none;border:0;color:var(--mut);cursor:pointer;padding:0;font:inherit;text-decoration:underline}
#msg{min-height:1.4em;margin-top:12px;font-size:13px}.err{color:#fca5a5}.ok{color:#86efac}
</style></head><body><main>
<h1 id="title">Sign in to SENTRIX</h1><p id="sub">Authorized security assessment platform.</p>
<form id="f" novalidate>
<label for="email" id="lemail">Email</label><input id="email" type="email" autocomplete="email" required>
<div id="pwrow"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" minlength="8"></div>
<button class="primary" id="go" type="submit">Sign in</button><div id="msg" role="status" aria-live="polite"></div></form>
<div class="links"><button id="toggle" type="button">${opts.signupEnabled ? "Create an account" : ""}</button><button id="forgot" type="button">Forgot password?</button></div>
</main><script>
(function(){
var mode=new URLSearchParams(location.search).get('mode')||'signin';var next=new URLSearchParams(location.search).get('next')||'/';
var $=function(i){return document.getElementById(i)};var signup=${opts.signupEnabled ? "true" : "false"};
function set(m){mode=m;var t={signin:['Sign in to SENTRIX','Sign in'],signup:['Create your account','Create account'],reset:['Reset password','Send reset link'],update:['Choose a new password','Update password']}[m];
$('title').textContent=t[0];$('go').textContent=t[1];$('pwrow').style.display=(m==='reset')?'none':'block';
$('lemail').style.display=$('email').style.display=(m==='update')?'none':'block';$('password').autocomplete=(m==='signin')?'current-password':'new-password';
$('toggle').textContent=signup?(m==='signup'?'Have an account? Sign in':'Create an account'):'';$('msg').textContent=''}
set(mode);
$('toggle').onclick=function(){set(mode==='signup'?'signin':'signup')};$('forgot').onclick=function(){set('reset')};
$('f').onsubmit=async function(e){e.preventDefault();var b=$('go'),m=$('msg');m.className='';m.textContent='';b.disabled=true;
var path={signin:'login',signup:'register',reset:'reset',update:'update-password'}[mode];
try{var r=await fetch('/api/auth/'+path,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:$('email').value.trim(),password:$('password').value,next:next})});
var j=await r.json().catch(function(){return{}});
if(!r.ok){m.className='err';m.textContent=j.message||'Request failed.';}
else if(j.redirect){location.assign(j.redirect)}else{m.className='ok';m.textContent=j.message||'Done.'}}
catch(x){m.className='err';m.textContent='Network error. Try again.'}finally{b.disabled=false}};
})();
</script></body></html>`;
}
