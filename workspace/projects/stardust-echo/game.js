const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const story={
 prologue:[
  {chapter:['序章','八月九日，星忘记名字的夜晚'],scene:'observatory',name:'旁白',text:'八月九日，周日。蝉鸣像一场不会结束的雨，旧校舍顶层却冷得不像夏天。'},
  {name:'旁白',text:'我循着一封没有署名的邀请函，推开废弃天文社的门。'},
  {name:'？？',char:'aoi',text:'你迟到了四年零三十七天。'},
  {name:'我',text:'窗边的少女拥有浅蓝色长发和红宝石般的眼睛。可我确定，自己从未见过她。'},
  {name:'星见苍依',char:'aoi',text:'别急着否认。今晚零点，英仙座流星雨落下之后，你又会忘记我。'},
  {name:'我',text:'“又”？'},
  {name:'星见苍依',char:'aoi',text:'所以这一次，请你在忘记之前，替我做一个选择。'},
  {choice:[['相信她，留下来','trust'],['去找青梅竹马夕月','yuzuki'],['检查那台旧望远镜','scope']]}
 ],
 trust:[
  {chapter:['第一章','透明的转校生'],scene:'school',name:'旁白',text:'第二天，班主任介绍了一位转校生。教室里却只有我能看见苍依。'},
  {name:'星见苍依',char:'aoi',text:'我不是幽灵。准确地说，我是被这个世界“漏记”的人。'},
  {name:'朝雾夕月',char:'yuzuki',text:'你从刚才开始，一直在和谁说话？'},
  {name:'我',text:'夕月笑着，手指却紧攥住了书包带。'},
  {name:'星见苍依',char:'aoi',text:'她其实记得我。只是每到日出，记忆都会被改写。'},
  {choice:[['把邀请函交给夕月','share'],['暂时隐瞒苍依的存在','hide']]}
 ],
 yuzuki:[
  {chapter:['第一章','没有寄出的夏祭照片'],scene:'rooftop',name:'朝雾夕月',char:'yuzuki',text:'你果然去了天文社。小时候的你，每次害怕都会往那里跑。'},
  {name:'我',text:'夕月拿出一张四年前的照片。照片中间被阳光灼成一片空白。'},
  {name:'朝雾夕月',char:'yuzuki',text:'这里原本还有一个女孩。我们三个约好，要一起看今年的流星雨。'},
  {name:'我',text:'我第一次意识到，遗忘并不是空白，而是一块被刻意挖走的伤口。'},
  {choice:[['和夕月一起调查照片','share'],['独自返回天文社','hide']]}
 ],
 scope:[
  {chapter:['第一章','镜中四年前的星空'],scene:'night',name:'旁白',text:'望远镜里没有星，只有四年前的天文社。'},
  {name:'我',text:'年幼的我们围着苍依。她正把一枚陨石碎片装进观测仪。'},
  {name:'星见苍依',char:'aoi',text:'那晚的实验救了你，却把我从所有人的因果中抹掉了。'},
  {name:'我',text:'记忆像碎玻璃一样回到脑海。我终于记起她哭着说“不要回头”。'},
  {choice:[['握住苍依的手，直面记忆','share'],['害怕真相，移开视线','hide']]}
 ],
 share:[
  {chapter:['第二章','三个人的星图'],scene:'festival',name:'旁白',text:'夏祭的灯火下，我们把各自残缺的记忆拼成了一张星图。'},
  {name:'朝雾夕月',char:'yuzuki',text:'我每天都在日记第一行写：苍依是我们的朋友。可第二天，字迹会变成空白。'},
  {name:'星见苍依',char:'aoi',text:'只要毁掉陨石，我就能回到世界里。但代价是，当年被救下的你会消失。'},
  {name:'我',text:'午夜将近。远处第一颗流星划破天空。'},
  {choice:[['牺牲自己的存在，归还苍依的人生','sacrifice'],['拒绝任何人消失，寻找第三条路','trueCheck'],['请求苍依让一切维持原样','aoiEnd']]}
 ],
 hide:[
  {chapter:['第二章','被选择的遗忘'],scene:'night',name:'旁白',text:'我试图独自承担秘密，却让夕月再次被改写记忆。'},
  {name:'朝雾夕月',char:'yuzuki',text:'为什么我明不认识她，看到那颗星时却会哭？'},
  {name:'星见苍依',char:'aoi',text:'隐瞒不是保护。没有共同记住的人，约定只会变成诅咒。'},
  {choice:[['向夕月坦白全部真相','share'],['陪夕月离开这座小镇','yuzukiEnd']]}
 ],
 sacrifice:[
  {scene:'observatory',name:'我',text:'如果四年前是她救了我，那么现在轮到我把明天还给她。'},
  {name:'星见苍依',char:'aoi',text:'笨蛋……我等你这么久，不是为了看你消失。'},
  {ending:['流星之后的空座位','苍依重新成为普通的学生。没有人再记得那个替她许愿的少年，只有她的星图上永远留着一个无名坐标。','END 01']}
 ],
 aoiEnd:[
  {scene:'observatory',name:'星见苍依',char:'aoi',text:'那么每年只有今晚，我会来见你。直到我们都老去。'},
  {name:'旁白',text:'这是一个温柔，却永远无法迎来清晨的约定。'},
  {ending:['一年一夜的恋人','每逢八月九日，废弃天文社的灯都会亮起。少年与不存在的少女，共享仅有一夜的夏天。','END 02']}
 ],
 yuzukiEnd:[
  {scene:'rooftop',name:'朝雾夕月',char:'yuzuki',text:'我们去一个没有天文社、没有旧照片的城市。也许忘记并不全是坏事。'},
  {name:'旁白',text:'列车开动时，我看见站台上有一抹浅蓝色。再眨眼，那里只剩盛夏的风。'},
  {ending:['没有星的远方','我与夕月开始了新的生活。偶尔仰望夜空时，心中仍会浮现一个无法念出的名字。','END 03']}
 ],
 trueCheck:[
  {scene:'night',name:'我',text:'陨石抹去的不是生命，而是“观测结果”。只要有足够多的人同时记住苍依，世界就无法否认她。'},
  {name:'朝雾夕月',char:'yuzuki',text:'所以，我们要让全城的人一起看见她？'},
  {name:'星见苍依',char:'aoi',text:'天文社的旧广播塔……可以把望远镜影像投到夏祭烟火上。'},
  {choice:[['启动全城观测计划','trueEnd'],['认为风险太大，放弃计划','aoiEnd']]}
 ],
 trueEnd:[
  {chapter:['终章','星屑回声'],scene:'climax',name:'旁白',text:'零点，望远镜的影像越过屋顶，投向整片夜空。'},
  {name:'朝雾夕月',char:'yuzuki',text:'大家，看那颗最亮的星！她叫星见苍依！'},
  {name:'旁白',text:'成千上万的人同时念出她的名字。被世界删去的少女，第一次拥有了影子。'},
  {name:'星见苍依',char:'aoi',text:'早上好。'},
  {name:'我',text:'晨光越过窗沿。她没有消失。'},
  {name:'星见苍依',char:'aoi',text:'这次不是“明年见”了。明天、后天，还有很多普通的日子……请多关照。'},
  {ending:['星空记得我们','苍依回归世界，夕月保留了全部记忆。天文社重新开放，而那枚陨石成为三个人共同保守的秘密。','TRUE END']}
 ]
};
const state={route:'prologue',index:0,log:[],auto:false,skip:false,settings:{speed:28,auto:180},endings:JSON.parse(localStorage.getItem('se_endings')||'[]')};
let typing=false,timer=null,autoTimer=null,currentText='';
function showScreen(id){$$('.screen').forEach(x=>x.classList.remove('active'));$('#'+id).classList.add('active')}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),150)}
function setScene(s){$('#scene').className='scene scene-'+(s||'observatory');$('#scene').innerHTML='<div class="scene-overlay"></div><div class="scene-stars"></div>'}
function setChar(c){const l=$('#char-left'),r=$('#char-right');l.className='character left';r.className='character right';if(c==='aoi')l.classList.add('show');if(c==='yuzuki'){r.classList.add('show','yuzuki')}}
function typeText(text){clearInterval(timer);typing=true;currentText=text;const d=$('#dialogue');d.textContent='';let i=0;timer=setInterval(()=>{d.textContent+=text[i++]||'';if(i>=text.length){clearInterval(timer);typing=false;scheduleAuto()}},Math.max(6,state.skip?2:Number(state.settings.speed)))}
function scheduleAuto(){clearTimeout(autoTimer);if(state.auto)autoTimer=setTimeout(next,Number(state.settings.auto)*10)}
function play(){clearTimeout(autoTimer);const line=(story[state.route]||[])[state.index];if(!line)return title();if(line.chapter)showChapter(...line.chapter);if(line.scene)setScene(line.scene);setChar(line.char);if(line.choice)return choices(line.choice);if(line.ending)return ending(line.ending);$('#choice-box').classList.add('hidden');$('#nameplate').textContent=line.name||'旁白';typeText(line.text||'');state.log.push({name:line.name||'旁白',text:line.text||''});if(state.log.length>80)state.log.shift();localStorage.setItem('se_resume',JSON.stringify(snapshot()))}
function next(){if(!$('#modal').classList.contains('hidden'))return;if(!$('#choice-box').classList.contains('hidden'))return;if(typing){clearInterval(timer);$('#dialogue').textContent=currentText;typing=false;scheduleAuto();return}state.index++;play()}
function choices(items){typing=false;$('#nameplate').textContent='选择';$('#dialogue').textContent='此刻的决定，会改变星空的形状。';const box=$('#choice-box');box.innerHTML='';box.classList.remove('hidden');items.forEach(([text,target])=>{const b=document.createElement('button');b.className='choice';b.textContent=text;b.onclick=()=>{box.classList.add('hidden');state.route=target;state.index=0;play()};box.appendChild(b)})}
function showChapter(a,b){const c=$('#chapter-card');c.querySelector('strong').textContent=a;c.querySelector('span').textContent=b;c.classList.remove('show');void c.offsetWidth;c.classList.add('show')}
function ending(e){clearTimeout(autoTimer);const [title,desc,code]=e;if(!state.endings.includes(code)){state.endings.push(code);localStorage.setItem('se_endings',JSON.stringify(state.endings))}openModal('结局达成',`<div class="ending-card"><small>${code}</small><h3>${title}</h3><p>${desc}</p><button class="choice" onclick="title()">返回标题画面</button></div>`)}
function snapshot(){return{route:state.route,index:state.index,log:state.log,settings:state.settings}}
function start(route='prologue',index=0){state.route=route;state.index=index;state.log=[];showScreen('game-screen');closeModal();play()}
function title(){state.auto=false;state.skip=false;clearTimeout(autoTimer);closeModal();showScreen('title-screen')}
function openModal(t,html){$('#modal-title').textContent=t;$('#modal-content').innerHTML=html;$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden')}
function saveMenu(mode){let html='<div class="slots">';for(let i=1;i<=6;i++){let s=JSON.parse(localStorage.getItem('se_slot_'+i)||'null');html+=`<button class="slot" data-slot="${i}"><b>存档 ${String(i).padStart(2,'0')}</b><small>${s?`${s.route} / 第 ${s.index+1} 段`:'— 空 —'}</small></button>`}html+='</div>';openModal(mode==='save'?'保存进度':'读取进度',html);$$('[data-slot]').forEach(b=>b.onclick=()=>{const k='se_slot_'+b.dataset.slot;if(mode==='save'){localStorage.setItem(k,JSON.stringify(snapshot()));toast('已保存到存档 '+b.dataset.slot);saveMenu('save')}else{const s=JSON.parse(localStorage.getItem(k)||'null');if(!s)return toast('该存档为空');Object.assign(state,s);showScreen('game-screen');closeModal();play()}})}
function logMenu(){openModal('对话回想',state.log.length?state.log.map(x=>`<div class="log-entry"><b>${x.name}</b><br>${x.text}</div>`).reverse().join(''):'<p>还没有可以回想的对白。</p>')}
function settings(){openModal('环境设定',`<div class="setting-row"><span>文字速度</span><input id="speed" type="range" min="6" max="60" value="${state.settings.speed}"></div><div class="setting-row"><span>自动播放间隔</span><input id="autospd" type="range" min="80" max="400" value="${state.settings.auto}"></div><p>操作：点击文本框、按 Enter 或 Space 推进；Esc 关闭窗口。</p>`);$('#speed').oninput=e=>state.settings.speed=e.target.value;$('#autospd').oninput=e=>state.settings.auto=e.target.value}
function chapterMenu(){const unlocked=[['序章','prologue'],['苍依路线','trust'],['夕月路线','yuzuki']];if(state.endings.length)unlocked.push(['终章·星屑回声','trueEnd']);openModal('章节选择','<div class="chapters">'+unlocked.map(([n,r])=>`<button class="chapter-btn" data-route="${r}"><b>${n}</b><small>从章节开头开始</small></button>`).join('')+'</div>');$$('[data-route]').forEach(b=>b.onclick=()=>start(b.dataset.route))}
function gallery(){const all=[['END 01','流星之后的空座位','key-visual.png'],['END 02','一年一夜的恋人','key-visual.png'],['END 03','没有星的远方','bg-sunset.png'],['TRUE END','星空记得我们','cg-climax.png']];openModal('回忆画廊','<div class="gallery">'+all.map(([c,n,img])=>`<div class="cg ${state.endings.includes(c)?'':'locked'}" style="background-image:url('${img}')"><span>${state.endings.includes(c)?n:'LOCKED'}</span></div>`).join('')+'</div>')}
$$('[data-title-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.titleAction;if(a==='new')start();if(a==='continue'){const s=JSON.parse(localStorage.getItem('se_resume')||'null');s?(Object.assign(state,s),showScreen('game-screen'),play()):toast('暂无继续数据')}if(a==='chapter')chapterMenu();if(a==='gallery')gallery();if(a==='settings')settings()});
$$('[data-quick]').forEach(b=>b.onclick=e=>{e.stopPropagation();const a=b.dataset.quick;if(a==='save')saveMenu('save');if(a==='load')saveMenu('load');if(a==='log')logMenu();if(a==='settings')settings();if(a==='title')title();if(a==='auto'){state.auto=!state.auto;b.classList.toggle('on',state.auto);toast(state.auto?'自动播放开启':'自动播放关闭');scheduleAuto()}if(a==='skip'){state.skip=!state.skip;b.classList.toggle('on',state.skip);toast(state.skip?'快速模式开启':'快速模式关闭');if(state.skip&&!typing)next()}});
$('#textbox').onclick=next;$('#modal-close').onclick=closeModal;$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if((e.key==='Enter'||e.code==='Space')&&$('#game-screen').classList.contains('active')){e.preventDefault();next()}});window.title=title;
