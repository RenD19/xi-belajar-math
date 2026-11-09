/* ==========================================================================
   kuis.js · TAB KUIS
   Wadah: <section id="tab-kuis" data-tahap="masuk|kerja|hasil">.
   Soal dibangkitkan dari benih (seed) yang diberikan server; setiap percobaan
   jawaban dicatat sebagai jejak, disimpan ke server, dan dinilai ulang di server.
   Setiap langkah paling banyak 2 percobaan (2 / 1 / 0 poin).
   ========================================================================== */
(function(PL){
'use strict';
var U=PL.U,$=U.$,esc=U.esc,nm=U.nm;
var CONFIG=window.OPTIMUM_CONFIG||{ENDPOINT:'',MATERI:'optimum'};
var sec,L;
var K={pack:null,trace:[],sess:null,tahap:'masuk',send:null,after:null,g:null,deadline:0};

function setTahap(t){K.tahap=t;sec.dataset.tahap=t;L.S.tahap=t;}
function sinkron(){
  K.g=CORE.gradeTrace(K.pack,K.trace);
  if(K.g.complete)return;
  var p=K.g.p,s=K.g.s;
  if(L.S.Q!==K.pack.set[p]||L.S.s!==s)L.muat(K.pack.set[p],s);
  L.S.tries=K.g.tries;L.S.selesai=false;
}
function render(){
  sec.dataset.tahap=K.tahap;
  if(K.tahap==='masuk'){panelMasuk();L.kosong();return;}
  if(K.tahap==='hasil'){panelHasil();L.kosong('Kuis selesai.');return;}
  L.renderKartu();L.renderProgres();L.panelLangkah();
  if(K.after){L.kunciSemua();tampilSesudah();}
  L.renderBidang();
}
function mulai(){
  PL.Plus.home();
  if(K.sess&&K.tahap==='kerja'&&K.pack){sinkron();render();PL.Plus.say('sapa');return;}
  K.send=null;K.after=null;
  if(CONFIG.ENDPOINT){K.sess=null;K.pack=null;K.trace=[];setTahap('masuk');render();ping();}
  else mulaiKuis(U.seed(),{token:null,nama:'',sisaDetik:60*60},[]);
}
function mulaiKuis(seed,sess,jejak){
  K.send=null;K.after=null;
  K.pack=CORE.buildPack(seed);
  K.trace=Array.isArray(jejak)?jejak.slice():[];
  var lt=K.trace.length?Number(K.trace[K.trace.length-1].t)||0:0;
  sess.t0c=performance.now()-(lt?lt+1000:0);
  K.sess=sess;K.deadline=Date.now()+Math.max(0,sess.sisaDetik||0)*1000;
  L.S.Q=null;sinkron();setTahap('kerja');
  sv.ok=true;sv.busy=false;sv.dirty=false;
  if(K.g.complete){selesai();return;}
  render();PL.Plus.say('sapa');
  if(sess.lanjut&&K.trace.length)PL.Plus.ucap('Selamat datang kembali! Kita lanjutkan dari soal '+(K.g.p+1)+'.');
  mulaiWaktu();
}
/* merekam setiap percobaan jawaban (bukan skor!) untuk dinilai ulang oleh server */
function catat(a){
  var p=K.g.p,s=K.g.s;
  K.trace.push({p:p,s:s,a:a,t:Math.round(performance.now()-K.sess.t0c)});
  simpanLokal();simpanServer();
}
function periksa(a,r){
  if(K.after)return;
  var sebelum=K.g.done;
  catat(a);
  K.g=CORE.gradeTrace(K.pack,K.trace);
  if(K.g.done>sebelum){
    var pts=K.g.steps[K.g.steps.length-1];
    K.after={pts:pts};
    if(!r.ok)L.isiKunci();
    L.S.solved=true;
    L.panelLangkah();L.kunciSemua();if(r.ok)L.tandai(r);
    tampilSesudah();L.renderKartu();L.renderProgres();L.renderBidang();
    PL.Plus.say(pts>0?'benar':'salah');
  }else{
    L.S.tries=K.g.tries;L.tandai(r);
    L.fb('bad','Belum tepat. '+L.pesanTitikUji(r)+'Kamu punya <b>satu kesempatan lagi</b> untuk langkah ini.');
    PL.Plus.say('salah');L.renderKartu();
  }
}
function tampilSesudah(){
  var A=K.after;if(!A)return;
  var akhir=K.g.complete;
  if(A.pts===2)L.fb('ok','✔ Benar pada percobaan pertama, <b>+2 poin</b>.'+L.teksSederhana());
  else if(A.pts===1)L.fb('ok','✔ Benar pada percobaan kedua, <b>+1 poin</b>.'+L.teksSederhana());
  else L.fb('bad','✗ Belum tepat dua kali, jadi <b>0 poin</b>. Jawaban yang benar adalah <b>'+L.teksKunci()+'</b>.');
  var soalBaru=!akhir&&K.g.s===0;
  L.tombol('<button class="btn primary" data-aksi="lanjut">'+(akhir?'Selesai, kirim skor ➜':soalBaru?'Soal berikutnya ➜':'Langkah berikutnya ➜')+'</button>');
}
function lanjut(){K.after=null;if(K.g.complete){selesai();return;}sinkron();render();}
function selesai(){setTahap('hasil');hentiWaktu();render();kirimSkor();}
function meta(){
  var g=K.g||{score:0,max:0,done:0,p:0},p=Math.min(CORE.NSOAL-1,g.p),Q=L.S.Q;
  return (K.sess&&K.sess.nama?esc(K.sess.nama)+' · ':'')+'Soal '+(p+1)+' dari '+CORE.NSOAL+' · '+esc(Q.jd)+' · '+esc(Q.lv)+' · Skor '+g.score+' / '+g.max
    +' · <span class="tmr">⏱ '+sisa()+'</span>'+(CONFIG.ENDPOINT?' · <span class="svb">'+svTeks()+'</span>':' · <span class="muted">mode uji</span>');
}
/* ---------- waktu ---------- */
var tmrId=null;
function sisa(){var d=Math.max(0,Math.round((K.deadline-Date.now())/1000));return 'sisa '+Math.floor(d/60)+' menit '+(d%60)+' detik';}
function mulaiWaktu(){hentiWaktu();tmrId=setInterval(function(){
  var e=sec.querySelector('.tmr');if(e)e.textContent='⏱ '+sisa();
  if(Date.now()>=K.deadline&&K.tahap==='kerja'){hentiWaktu();PL.Plus.ucap('Waktu habis! Jawabanmu dikirim.');K.after=null;selesai();}
},1000);}
function hentiWaktu(){if(tmrId)clearInterval(tmrId);tmrId=null;}

/* ---------- koneksi ke server (Google Apps Script) ---------- */
/* SEB memicu preflight CORS yang tidak bisa dijawab Apps Script, sehingga jawaban fetch terblokir.
   Di SEB (atau dengan ?kirim=form saat menguji) data dikirim lewat formulir ke iframe tersembunyi;
   server membalas lewat postMessage. Di peramban biasa tetap memakai fetch. */
function pakaiForm(){return /\bSEB\b/.test(navigator.userAgent)||/[?&]kirim=form\b/.test(location.search);}
function serverForm(obj){
  return new Promise(function(terima,tolak){
    var rid='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,12),tm=null;
    var fr=document.createElement('iframe'),fm=document.createElement('form');
    fr.name='kirim-'+rid;fr.title='Pengiriman data kuis';fr.setAttribute('aria-hidden','true');fr.tabIndex=-1;fr.style.display='none';
    fm.method='POST';fm.action=CONFIG.ENDPOINT;fm.target=fr.name;fm.acceptCharset='UTF-8';fm.style.display='none';
    [['transport','form'],['rid',rid],['asal',location.origin],['payload',JSON.stringify(obj)]].forEach(function(p){
      var i=document.createElement('input');i.type='hidden';i.name=p[0];i.value=p[1];fm.appendChild(i);
    });
    function bersih(){clearTimeout(tm);window.removeEventListener('message',dengar);if(fr.parentNode)fr.parentNode.removeChild(fr);if(fm.parentNode)fm.parentNode.removeChild(fm);}
    function dengar(ev){
      if(!/^https:\/\/(script\.google\.com|([a-z0-9-]+\.)*[a-z0-9-]*script\.googleusercontent\.com)$/.test(ev.origin))return;
      var d=ev.data;if(!d||d.optimumRid!==rid)return;
      bersih();terima(d.data);
    }
    window.addEventListener('message',dengar);
    tm=setTimeout(function(){bersih();var e=new Error('Waktu habis');e.name='AbortError';tolak(e);},30000);
    document.body.appendChild(fr);document.body.appendChild(fm);
    fm.submit();
  });
}
function server(obj){
  if(pakaiForm())return serverForm(obj);
  var ctl=('AbortController' in window)?new AbortController():null,tm=null;
  if(ctl)tm=setTimeout(function(){ctl.abort();},30000);
  return fetch(CONFIG.ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(obj),signal:ctl?ctl.signal:undefined})
    .then(function(r){if(tm)clearTimeout(tm);return r.json();});
}
function pesanJaringan(err){return err&&err.name==='AbortError'?'Server tidak merespons (waktu habis). Coba lagi.':'Tidak dapat terhubung ke server. Periksa internet, lalu coba lagi.';}
var PKEY='optimum-skor-tertunda-'+CONFIG.MATERI,GKEY='optimum-progres-'+CONFIG.MATERI;
function simpanTertunda(o){try{localStorage.setItem(PKEY,JSON.stringify(o));}catch(e){}}
function ambilTertunda(){try{var x=localStorage.getItem(PKEY);return x?JSON.parse(x):null;}catch(e){return null;}}
function hapusTertunda(){try{localStorage.removeItem(PKEY);}catch(e){}}
function simpanLokal(){if(!K.sess||!K.sess.token)return;try{localStorage.setItem(GKEY,JSON.stringify({token:K.sess.token,trace:K.trace}));}catch(e){}}
function ambilLokal(token){try{var x=JSON.parse(localStorage.getItem(GKEY)||'null');return x&&x.token===token&&Array.isArray(x.trace)?x.trace:null;}catch(e){return null;}}
function hapusLokal(){try{localStorage.removeItem(GKEY);}catch(e){}}
function fatal(r){return !!r&&(r.kode==='token'||r.kode==='habis'||r.kode==='versi'||r.kode==='jejak');}
/* penyimpanan progres: setiap percobaan dikirim ke server agar siswa bisa melanjutkan bila keluar */
var sv={busy:false,dirty:false,ok:true};
function svTeks(){return sv.busy||sv.dirty?'⏳ menyimpan…':sv.ok?'☁ tersimpan':'⚠ <b>belum tersimpan</b>';}
function svTampil(){var e=sec.querySelector('.svb');if(e)e.innerHTML=svTeks();}
function simpanServer(){
  if(!CONFIG.ENDPOINT||!K.sess||!K.sess.token)return;
  if(sv.busy){sv.dirty=true;svTampil();return;}
  sv.busy=true;sv.dirty=false;svTampil();
  server({action:'simpan',materi:CONFIG.MATERI,token:K.sess.token,trace:K.trace.slice(),cek:CORE.cek()})
    .then(function(r){sv.busy=false;sv.ok=!!(r&&r.ok);if(sv.dirty)simpanServer();else if(!sv.ok&&!fatal(r))setTimeout(function(){if(!sv.busy&&K.tahap==='kerja')simpanServer();},4000);svTampil();})
    .catch(function(){sv.busy=false;sv.ok=false;svTampil();if(sv.dirty)setTimeout(simpanServer,3000);});
}
function belumTersimpan(){return K.tahap==='kerja'&&!!K.sess&&!!CONFIG.ENDPOINT&&(sv.busy||sv.dirty||!sv.ok);}
var hasilPing=null;
function ping(){
  if(!CONFIG.ENDPOINT||hasilPing)return;
  server({action:'ping'}).then(function(r){hasilPing=r&&r.ok?(r.cek===CORE.cek()?'ok':'beda'):'gagal';var e=sec.querySelector('.lgCek');if(e)e.innerHTML=teksCek();})
    .catch(function(){hasilPing=null;var e=sec.querySelector('.lgCek');if(e)e.innerHTML=teksCek(true);});
}
function teksCek(err){
  if(err)return '<span class="badc">⚠ Server belum dapat dihubungi.</span>';
  if(hasilPing==='ok')return '<span class="okc">✔ Halaman dan server cocok (versi '+esc(CORE.VERSI)+').</span>';
  if(hasilPing==='beda')return '<span class="badc">⚠ Versi halaman berbeda dengan server. Beri tahu gurumu.</span>';
  if(hasilPing==='gagal')return '<span class="badc">⚠ Server menjawab tidak normal.</span>';
  return '<span class="muted">⏳ Memeriksa server…</span>';
}
function panelMasuk(){
  var pend=ambilTertunda();
  L.el.panel.innerHTML='<h2>Kuis · Masuk</h2>'
    +'<div class="note"><p>Kuis berisi <b>'+CORE.NSOAL+' soal</b> (setiap soal 2–3 langkah). Setiap langkah boleh dicoba <b>dua kali</b>. Benar pada percobaan pertama mendapat 2 poin, pada percobaan kedua 1 poin.</p>'
    +'<p>Skor <b>disetor ke gurumu</b> dan dihitung ulang oleh server dari jawabanmu, jadi kerjakan sendiri. Jawabanmu <b>tersimpan otomatis</b>. Jika halaman tertutup atau kamu pindah tab, masuk lagi (dalam batas waktu) untuk melanjutkan.</p></div>'
    +'<p class="lgCek">'+teksCek()+'</p>'
    +(pend?'<div class="rule">Ada skor yang <b>belum terkirim</b> dari kuis sebelumnya. <button class="btn" data-aksi="kirim-tertunda">Kirim sekarang</button></div>':'')
    +'<div class="form"><div class="two"><label>Kelas<input id="lgKelas" autocomplete="off" placeholder="mis. AL FATTAH" maxlength="20"></label>'
    +'<label>No. absen<input id="lgAbsen" type="number" inputmode="numeric" min="1" max="99" placeholder="mis.1"></label></div>'
    +'<label>PIN<input id="lgPin" type="password" autocomplete="off" placeholder="dari gurumu" maxlength="20"></label>'
    +'<label>Nama atau inisial <small>(isi hanya bila gurumu belum menyiapkan daftar siswa)</small><input id="lgNama" autocomplete="off" maxlength="40"></label></div>'
    +'<div class="fb lgMsg" hidden></div>'
    +'<div class="row"><button class="btn primary" data-aksi="masuk">Masuk kuis ➜</button></div>';
}
function pesanMasuk(kind,html){var e=sec.querySelector('.lgMsg');if(!e)return;e.hidden=false;e.className='fb lgMsg '+kind;e.innerHTML=html;}
function masuk(btn){
  var kelas=$('#lgKelas').value.trim(),absen=$('#lgAbsen').value.trim(),pin=$('#lgPin').value,nama=$('#lgNama').value.trim();
  if(!kelas||!absen){pesanMasuk('info','Isi kelas dan nomor absen.');return;}
  btn.disabled=true;pesanMasuk('info','⏳ Menghubungi server…');
  server({action:'start',materi:CONFIG.MATERI,kelas:kelas,absen:absen,pin:pin,nama:nama,cek:CORE.cek()})
    .then(function(res){
      if(!res||!res.ok){btn.disabled=false;pesanMasuk('bad',esc((res&&res.pesan)||'Gagal masuk.'));return;}
      var jj=Array.isArray(res.jejak)?res.jejak:[],loc=ambilLokal(res.token);
      var pre=loc&&loc.length>jj.length&&JSON.stringify(loc.slice(0,jj.length))===JSON.stringify(jj);
      mulaiKuis(res.seed,{token:res.token,nama:res.nama,lanjut:!!res.lanjut,sisaDetik:res.sisaDetik},pre?loc:jj);
      if(pre)simpanServer();
    })
    .catch(function(err){btn.disabled=false;pesanMasuk('bad',pesanJaringan(err));});
}
function badanKirim(){return {action:'submit',materi:CONFIG.MATERI,token:K.sess.token,trace:K.trace,klaim:{skor:K.g.score,maks:K.g.max},cek:CORE.cek()};}
function kirimSkor(){
  if(!CONFIG.ENDPOINT||!K.sess||!K.sess.token){K.send={state:'off'};render();return;}
  var body=badanKirim();simpanTertunda(body);kirim(body);
}
var AUTO_JEDA=[4000,8000];   /* percobaan ulang otomatis: jeda (ms) sebelum percobaan ke-1 dan ke-2 */
var urut=0;
function kirim(body,n){
  var id=++urut;n=n||0;
  var basi=function(){return id!==urut;};
  var tampil=function(x){K.send=x;if(K.tahap==='hasil'&&PL.mode()==='kuis')render();};
  var gagal=function(msg,ulang){
    if(basi())return;
    if(ulang&&n<AUTO_JEDA.length){tampil({state:'sending',n:n+1,wait:true});setTimeout(function(){if(!basi())kirim(body,n+1);},AUTO_JEDA[n]);return;}
    tampil({state:'err',msg:msg,retry:ulang});
  };
  tampil({state:'sending',n:n});
  server(body).then(function(res){
    if(res&&res.ok){hapusTertunda();hapusLokal();if(!basi())tampil({state:'ok',res:res});}
    else{var f=fatal(res);if(f)hapusTertunda();gagal((res&&res.pesan)||'Server menolak skor.',!f);}
  }).catch(function(err){gagal(pesanJaringan(err),true);});
}
function kirimTertunda(){
  var p=ambilTertunda();if(!p)return;
  pesanMasuk('info','⏳ Mengirim skor tertunda…');
  server(p).then(function(res){
    if(res&&res.ok){hapusTertunda();pesanMasuk('ok','✔ Skor tertunda sudah terkirim ('+res.skor+' dari '+res.maks+').');var b=sec.querySelector('[data-aksi="kirim-tertunda"]');if(b)b.disabled=true;}
    else{if(fatal(res))hapusTertunda();pesanMasuk('bad',esc((res&&res.pesan)||'Gagal mengirim.'));}
  }).catch(function(err){pesanMasuk('bad',pesanJaringan(err));});
}
function skorBelumTerkirim(){var x=K.send;return K.tahap==='hasil'&&!!x&&(x.state==='sending'||(x.state==='err'&&x.retry));}
/* pemberitahuan skor tertunda di tab lain (dipanggil oleh tab Belajar dan Latihan) */
function pendNotice(el){
  if(!CONFIG.ENDPOINT||!ambilTertunda()||(K.tahap==='kerja'&&K.sess))return;
  var d=document.createElement('div');d.className='rule pendBar';
  d.innerHTML='<span class="pendMsg">⚠ Ada skor kuis yang <b>belum terkirim</b> ke gurumu.</span> <button class="btn" type="button">Kirim sekarang</button>';
  el.insertBefore(d,el.firstChild);
  var b=d.querySelector('button');
  b.onclick=function(){
    var p=ambilTertunda(),msg=d.querySelector('.pendMsg');if(!p)return;
    b.disabled=true;msg.innerHTML='⏳ Mengirim skor tertunda…';
    server(p).then(function(res){
      if(res&&res.ok){hapusTertunda();d.className='fb ok';d.innerHTML='✔ Skor tertunda sudah terkirim ('+res.skor+' dari '+res.maks+').'+(res.ulang?' (Skor ini sudah pernah dikirim sebelumnya.)':'');}
      else if(fatal(res)){hapusTertunda();d.className='fb bad';d.innerHTML=esc((res&&res.pesan)||'Server menolak skor.');}
      else{msg.innerHTML='⚠ '+esc((res&&res.pesan)||'Gagal mengirim.');b.disabled=false;}
    }).catch(function(err){msg.innerHTML='⚠ '+esc(pesanJaringan(err));b.disabled=false;});
  };
}
var RLAB={T2:'Tipe 2 · Sistem dari DP',T3:'Tipe 3 · Kasus kontekstual',T4:'Tipe 4 · Nilai maksimum/minimum',LOTS:'LOTS',MOTS:'MOTS',HOTS:'HOTS'};
function panelHasil(){
  var snd=K.send||{state:'off'},ok=snd.state==='ok',g=K.g,s=g.score,m=g.max,rin=g.rinci,miss;
  if(ok){s=snd.res.skor;m=snd.res.maks;rin=snd.res.rinci||rin;miss=snd.res.perluDiperkuat||[];}
  else miss=Object.keys(g.missed);
  var pct=m?Math.round(100*s/m):0;
  var pesan=pct>=90?'Luar biasa! Kamu sudah mahir menentukan nilai optimum.':pct>=70?'Bagus! Sedikit lagi kamu akan mahir.':'Ayo belajar lagi pelan-pelan di tab Belajar dan Latihan Mandiri, lalu coba lagi.';
  var h='<h2>Kuis selesai</h2><div class="score">'+s+'<small> / '+m+'</small></div><p><b>Nilai '+pct+'</b></p>';
  if(snd.state==='sending')h+='<div class="fb info">⏳ '+(snd.wait?'Pengiriman gagal. Mencoba lagi otomatis ('+snd.n+' dari '+AUTO_JEDA.length+')…':'Mengirim skor ke server…'+(snd.n?' (percobaan ulang '+snd.n+' dari '+AUTO_JEDA.length+')':''))+'</div>';
  else if(ok)h+='<div class="fb ok">✔ Skor dihitung ulang oleh server dari jawabanmu dan sudah tercatat untuk gurumu.'+(snd.res.ulang?' (Skor ini sudah pernah dikirim sebelumnya.)':'')+'</div>';
  else if(snd.state==='err')h+='<div class="fb bad">'+esc(snd.msg||'Gagal mengirim skor.')+(snd.retry?' Skormu <b>belum tercatat</b>. Pastikan internet menyala, lalu tekan “Kirim ulang”.':'')+'</div>';
  else h+='<div class="fb info">Mode uji, skor tidak disetor ke server.</div>';
  h+='<table class="tbl rinci"><tr><th>Bagian</th><th>Poin</th></tr>'+['T2','T3','T4','LOTS','MOTS','HOTS'].map(function(k){return '<tr><td>'+RLAB[k]+'</td><td>'+rin[k][0]+' / '+rin[k][1]+'</td></tr>';}).join('')+'</table>';
  h+='<p>'+pesan+'</p>'+(miss.length?'<p><b>Perlu diperkuat</b> → '+miss.map(esc).join(', ')+'.</p>':'<p>Semua langkah benar pada percobaan pertama. 👏</p>');
  var b='';
  if(snd.state==='err'&&snd.retry)b+='<button class="btn primary" data-aksi="kirim-ulang">Kirim ulang</button>';
  if(snd.state!=='sending'){
    if(!CONFIG.ENDPOINT||(ok&&snd.res.sisaPercobaan>0))b+='<button class="btn primary" data-aksi="ulangi-kuis">Ulangi kuis</button>';
    b+='<button class="btn" data-aksi="ke-latihan">Ke Latihan Mandiri</button>';
  }
  L.el.panel.innerHTML=h+'<div class="row">'+b+'</div>';
  if(snd.state==='ok'||snd.state==='off')PL.Plus.say('skor',pct);
}
function aksi(a,b){
  if(a==='lanjut')lanjut();
  else if(a==='masuk')masuk(b);
  else if(a==='kirim-tertunda')kirimTertunda();
  else if(a==='kirim-ulang')kirim(badanKirim());
  else if(a==='ulangi-kuis'){K.sess=null;K.pack=null;K.tahap='masuk';mulai();}
  else if(a==='ke-latihan')PL.pindahTab('latihan');
}

PL.kuis={pendNotice:pendNotice,K:K};
PL.TAB=PL.TAB||{};
PL.TAB.kuis={
  init:function(){
    sec=$('#tab-kuis');
    L=PL.Langkah(sec,{petunjuk:false,diManaSalah:false,pratinjau:true,periksa:periksa,aksi:aksi,meta:meta,bolehKlik:function(){return !K.after;}});
    this.bidang=L.bidang;this.L=L;
    L.el.panel.addEventListener('keydown',function(e){if(e.key==='Enter'&&/^lg/.test(e.target.id||'')){var b=sec.querySelector('[data-aksi="masuk"]');if(b&&!b.disabled)masuk(b);}});
    setTahap('masuk');
  },
  tampil:function(){mulai();},
  /* dipanggil sebelum pindah tab; false = batal pindah */
  sembunyi:function(){
    if(skorBelumTerkirim()&&!confirm(ambilTertunda()
      ?'Skormu belum tercatat di server. Kamu masih bisa mengirimnya nanti lewat Kuis di peramban dan perangkat ini, selama waktu kuis belum habis. Tetap pindah?'
      :'Skormu belum tercatat di server dan tidak dapat disimpan di peramban ini. Jika pindah, skor bisa hilang. Tetap pindah?'))return false;
    if(belumTersimpan()&&!confirm('Jawaban terakhirmu belum tersimpan di server (periksa internet). Jika pindah sekarang, kamu tetap bisa kembali ke tab Kuis di halaman ini. Tetap pindah?'))return false;
    if(K.tahap==='kerja'&&K.sess){K.after=null;PL.Plus.ucap('Kuis dijeda. Jawabanmu tersimpan. Kembali ke tab Kuis untuk melanjutkan.');}
    return true;
  },
  /* true = peringatkan sebelum halaman ditutup */
  jaga:function(){return belumTersimpan()||skorBelumTerkirim();}
};
})(window.PL);
