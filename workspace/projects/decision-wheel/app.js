const C=['#7c6cf0','#f472b6','#38bdf8','#4ade80','#fbbf24','#fb923c','#a78bfa','#34d399','#f87171','#60a5fa','#c084fc','#facc15','#2dd4bf','#fb7185','#818cf8'];
const P={meal:['火锅','烧烤','寿司','披萨','面条','炒饭','汉堡','沙拉','炸鸡','麻辣烫'],activity:['看电影','打游戏','看书','散步','听音乐','画画','健身','追剧','逛街','睡觉'],yesno:['Yes','No','Maybe','Ask again','Absolutely','Not today']};
var O=JSON.parse(localStorage.getItem('wo')||'[]');if(!O.length)O=['选项 A','选项 B','选项 C','选项 D'];
var ca=0,sp=false;
var cv=document.getElementById('wc'),x=cv.getContext('2d');
var sb=document.getElementById('sb'),rb=document.getElementById('rb'),rt=document.getElementById('rt');
var ol=document.getElementById('ol'),oc=document.getElementById('oc'),ai=document.getElementById('ai'),ab=document.getElementById('ab');
var cf=document.getElementById('cf');

function rc(){var r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=r.width*d;cv.height=r.height*d;x.setTransform(d,0,0,d,0,0);dw()}

function dw(){
  var w=cv.width/(window.devicePixelRatio||1),h=cv.height/(window.devicePixelRatio||1);
  var cx=w/2,cy=h/2,r=Math.min(cx,cy)-4;
  x.clearRect(0,0,w,h);
  if(!O.length){
    x.beginPath();x.arc(cx,cy,r,0,Math.PI*2);x.fillStyle='rgba(255,255,0.04)';x.fill();
    x.fillStyle='rgba(255,255,0.2)';x.font='14px sans-serif';x.textAlign='center';x.textBaseline='middle';
    x.fillText('添加选项开始',cx,cy);return;
  }
  var sa=Math.PI*2/O.length;
  O.forEach(function(o,i){
    var a0=ca+i*sa,a1=a0+sa;
    x.beginPath();x.moveTo(cx,cy);x.arc(cx,cy,r,a0,a1);x.closePath();
    x.fillStyle=C[i%C.length];x.fill();
    x.strokeStyle='rgba(0,0,0,0.15)';x.lineWidth=1;x.stroke();
    x.save();x.translate(cx,cy);x.rotate(a0+sa/2);
    x.textAlign='center';x.textBaseline='middle';x.fillStyle='#fff';
    x.font='bold 13px sans-serif';x.shadowColor='rgba(0,0,0,0.5)';x.shadowBlur=4;
    if(o.length>6)x.font='bold 11px sans-serif';
    x.fillText(o,r*0.62,0);
    x.restore();
  });
  x.beginPath();x.arc(cx,cy,r+2,0,Math.PI*2);x.strokeStyle='rgba(255,255,0.1)';x.lineWidth=2;x.stroke();
}

function ro(){
  if(sp||O.length<2)return;
  sp=true;rb.classList.remove('v');
  var t=4000+Math.random()*2000;
  var sp2=8+Math.random()*6;
  var ea=ca+sp2*Math.PI*2;
  var s=performance.now();
  function frame(n){
    var p=Math.min((n-s)/t,1);
    var e=1-Math.pow(1-p,3);
    ca=ca+(ea-ca)*e;
    if(p<1)requestAnimationFrame(frame);
    else{ca=ea%(Math.PI*2);sp=false;sh();}
  }
  requestAnimationFrame(frame);
}

function sh(){
  var sa=Math.PI*2/O.length;
  var norm=((Math.PI*2-ca)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
  var idx=Math.floor(norm/sa);
  idx=(O.length-idx)%O.length;
  var winner=O[idx];
  rt.textContent=winner;
  rb.classList.add('v');
  confetti();
}

function confetti(){
  var colors=['#7c6cf0','#f472b6','#38bdf8','#4ade80','#fbbf24','#fb923c'];
  cf.innerHTML='';
  for(var i=0;i<60;i++){
    var p=document.createElement('div');
    p.className='cp';
    p.style.left=Math.random()*100+'%';
    p.style.top='-10px';
    p.style.background=colors[i%colors.length];
    p.style.width=(4+Math.random()*8)+'px';
    p.style.height=(4+Math.random()*8)+'px';
    p.style.borderRadius=Math.random()>0.5?'50%':'2px';
    p.style.transform='rotate('+Math.random()*360+'deg)';
    var dur=1.5+Math.random()*2;
    var xDrift=(Math.random()-0.5)*200;
    p.style.transition='all '+dur+'s cubic-bezier(.25,.46,.45,.94)';
    cf.appendChild(p);
    setTimeout(function(el){
      el.style.top='110%';
      el.style.left=(parseFloat(el.style.left)+xDrift)+'%';
      el.style.transform='rotate('+(Math.random()*720)+'deg)';
      el.style.opacity='0';
    },10+Math.random()*100,p);
  }
  setTimeout(function(){cf.innerHTML='';},3500);
}

function renderOptions(){
  ol.innerHTML='';
  oc.textContent=O.length+' 项';
  if(!O.length){
    ol.innerHTML='<div class="es"><span class="ei">🎡</span><span>还没有选项，添加一些吧</span></div>';
    return;
  }
  O.forEach(function(o,i){
    var item=document.createElement('div');
    item.className='oi';
    item.innerHTML='<div class="oc2" style="background:'+C[i%C.length]+'"></div>'+
      '<span class="ot">'+o+'</span>'+
      '<button class="od" data-idx="'+i+'">×</button>';
    ol.appendChild(item);
  });
  ol.querySelectorAll('.od').forEach(function(btn){
    btn.addEventListener('click',function(){
      var idx=parseInt(btn.dataset.idx);
      O.splice(idx,1);
      save();renderOptions();dw();
    });
  });
}

function save(){localStorage.setItem('wo',JSON.stringify(O));}

function addOption(){
  var v=ai.value.trim();
  if(!v)return;
  O.push(v);
  ai.value='';
  save();renderOptions();dw();
}

sb.addEventListener('click',ro);
ab.addEventListener('click',addOption);
ai.addEventListener('keydown',function(e){if(e.key==='Enter')addOption()});

document.querySelectorAll('.pc').forEach(function(btn){
  btn.addEventListener('click',function(){
    var key=btn.dataset.p;
    if(key==='clear'){O=[];}
    else{O=P[key]||[];}
    save();renderOptions();dw();
    rt.textContent='点击中心按钮开始';
    rb.classList.remove('v');
  });
});

window.addEventListener('resize',rc);
rc();
renderOptions();
