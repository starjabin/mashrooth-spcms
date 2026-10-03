// Mashrooth customer-care chat launcher.
// Loads the assistant in an isolated iframe so it cannot read workspace pages or sessions.
// The CSP only needs frame-src for the chat host; script-src and connect-src stay 'self'.
(function(){
  if(document.getElementById('care-chat'))return;
  var CHAT_URL='https://mashrooth-care-assistant.vercel.app/embed.html';
  var color='#22a6b3';
  var style=document.createElement('style');
  style.textContent=
    '#care-chat{position:fixed;bottom:20px;right:20px;z-index:2147483000;font:14px system-ui,sans-serif}'+
    '#care-chat-btn{width:56px;height:56px;border-radius:50%;border:0;background:'+color+';color:#fff;font-size:24px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);display:block;margin-left:auto}'+
    '#care-chat-frame{display:none;width:340px;max-width:calc(100vw - 40px);height:480px;margin-bottom:12px;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.4);background:#0f1b1d}'+
    '#care-chat-frame.open{display:block}';
  document.head.appendChild(style);

  var root=document.createElement('div');
  root.id='care-chat';
  var frame=document.createElement('iframe');
  frame.id='care-chat-frame';
  frame.title='Mashrooth support chat';
  frame.setAttribute('referrerpolicy','no-referrer');
  var btn=document.createElement('button');
  btn.id='care-chat-btn';
  btn.type='button';
  btn.setAttribute('aria-label','Open support chat');
  btn.textContent='💬';
  root.appendChild(frame);
  root.appendChild(btn);
  document.body.appendChild(root);

  btn.addEventListener('click',function(){
    if(!frame.src)frame.src=CHAT_URL; // load only when first opened
    frame.classList.toggle('open');
  });
})();
