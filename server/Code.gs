/* ==========================================================================
   SERVER SKOR KUIS · PROGRAM LINEAR: DARI CONTOH KONTEKSTUAL KE NILAI OPTIMUM
   (Google Apps Script + Google Sheets)
   --------------------------------------------------------------------------
   PROYEK APPS SCRIPT INI TERDIRI DARI DUA FILE:
     Code.gs  ← file ini (server: masuk, simpan progres, kirim skor)
     core.gs  ← salinan PERSIS js/core.js (pembangkit soal + penilai)
   Langkah pemasangan lengkap ada di README.md, bagian "Mengatur Google Apps Script".

   Ringkasnya:
   1. Buat Google Sheet BARU khusus materi ini → Ekstensi → Apps Script.
   2. Ganti isi Code.gs dengan file ini. Tambahkan file skrip "core" (+ → Skrip),
      lalu tempel SELURUH isi js/core.js ke dalamnya.
   3. Jalankan siapkan() sekali, isi sheet "Siswa", jalankan ujiCek().
   4. Deploy → Penerapan baru → Aplikasi web (Jalankan sebagai: Saya; Akses: Siapa saja).
   5. Tempel URL /exec ke js/config.js → ENDPOINT.

   SETIAP mengubah kode (Code.gs atau core.gs): Deploy → Kelola penerapan → ikon pensil →
   Versi: Versi baru → Terapkan (URL tetap sama).
   core.gs JANGAN disunting di editor Apps Script. Bila soal atau penilaian diubah,
   ubah js/core.js lalu tempel ulang seluruhnya ke core.gs (server menolak halaman
   yang kode "cek"-nya berbeda).

   Urutan file di editor tidak berpengaruh: file ini tidak memakai CORE di tingkat
   atas, hanya di dalam fungsi, sehingga aman walaupun core.gs berada di bawahnya.

   SHEET YANG DIISI SERVER
   Siswa : kelas | absen | nama | pin (diisi guru; kosong = MODE TERBUKA)
   Sesi  : satu baris per siswa yang masuk; kolom progres_json menyimpan jawaban
           sementara sehingga siswa yang keluar bisa melanjutkan dari langkah terakhir.
   Skor  : skor (maks. 82), nilai 0–100, poin per tipe dan per level (nilai maksimumnya
           tertulis di judul kolom, dihitung otomatis dari susunan kuis), durasi, langkah
           yang perlu diperkuat, dan catatan (mis. "dilanjutkan 1 kali", "terlalu-cepat").
   Jejak : seluruh jawaban mentah siswa untuk diperiksa ulang bila perlu.
   ========================================================================== */

var KONFIG={
  ID_SPREADSHEET:'',      /* kosongkan bila skrip dibuat dari dalam Google Sheet */
  BATAS_MENIT:60,         /* batas waktu kuis sejak siswa pertama kali masuk */
  TOLERANSI_MENIT:3,      /* kelonggaran pengiriman setelah batas waktu */
  MAKS_PERCOBAAN:1,       /* berapa kali satu siswa boleh mengerjakan kuis ini */
  IZIN_LANJUT:true,       /* siswa yang keluar boleh masuk lagi (soal sama), ditandai di Skor */
  SIMPAN_PROGRES:true,    /* simpan jawaban sementara agar siswa yang keluar tidak mengulang dari awal */
  MIN_DETIK_PER_LANGKAH:3,/* di bawah ini dianggap terlalu cepat (hanya ditandai, tidak ditolak) */
  MAKS_SALAH_PIN:5,       /* salah PIN berturut-turut sebelum dikunci sementara */
  KUNCI_MENIT:10,
  MAKS_PERISTIWA:200      /* batas panjang jejak jawaban (41 langkah × 2 percobaan, ditambah cadangan) */
};

/* ==========================  SERVER  ========================== */
var MATERI={
  optimum:{
    judul:'Program Linear: dari Contoh Kontekstual ke Nilai Optimum',
    bangun:function(seed){return CORE.buildPack(seed);},
    nilai:function(pack,jejak){return CORE.gradeTrace(pack,jejak);}
  }
};
var SH={siswa:'Siswa',sesi:'Sesi',skor:'Skor',jejak:'Jejak'};
/* maksimum poin setiap rincian (T2…HOTS), dihitung dari susunan kuis di CORE */
var RINCI=['T2','T3','T4','LOTS','MOTS','HOTS'];
var HDR={
  Siswa:['kelas','absen','nama','pin'],
  Sesi:['nonce','materi','kelas','absen','nama','seed','mulai_ms','batas_ms','status','skor','maks','hasil_json','mulai','lanjut','progres_json','progres_waktu'],
  Skor:null, /* diisi saat pertama dipakai (lihat di bawah), karena memerlukan CORE */
  Jejak:['nonce','waktu','jejak_json']
};
/* Judul kolom Skor memuat nilai maksimum setiap rincian (T2…HOTS) yang dihitung dari CORE.
   Dihitung saat pertama dipakai, bukan saat file dimuat, agar urutan file di editor
   Apps Script (Code.gs sebelum atau sesudah core.gs) tidak berpengaruh. */
var _hdrSkor=null;
Object.defineProperty(HDR,'Skor',{enumerable:true,get:function(){
  if(!_hdrSkor){
    var maks=CORE.gradeTrace(CORE.buildPack(1),[]).rinci;
    _hdrSkor=['waktu','kelas','absen','nama','materi','skor','maks','nilai']
      .concat(RINCI.map(function(k){return k+'_dari'+maks[k][1];}))
      .concat(['durasi_detik','perlu_diperkuat','catatan','nonce']);
  }
  return _hdrSkor;
}});
var COL_SESI={nonce:0,materi:1,kelas:2,absen:3,nama:4,seed:5,mulai:6,batas:7,status:8,skor:9,maks:10,hasil:11,teks:12,lanjut:13,progres:14,ptime:15};

function agora(){return Date.now();}
function gagal(kode,pesan){return {kode:kode,pesan:pesan};}
function ss(){return KONFIG.ID_SPREADSHEET?SpreadsheetApp.openById(KONFIG.ID_SPREADSHEET):SpreadsheetApp.getActiveSpreadsheet();}
function lembar(nama){
  var s=ss().getSheetByName(nama);
  if(!s)throw gagal('setelan','Server belum disiapkan (sheet "'+nama+'" tidak ada). Jalankan fungsi siapkan().');
  return s;
}
function norm(x){return String(x==null?'':x).toUpperCase().replace(/\s+/g,'').slice(0,20);}
function tanggal(ms){return Utilities.formatDate(new Date(ms),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm:ss');}
function rahasia(){
  var p=PropertiesService.getScriptProperties(),s=p.getProperty('RAHASIA');
  if(!s){s=Utilities.getUuid()+Utilities.getUuid();p.setProperty('RAHASIA',s);}
  return s;
}
function tanda(nonce){return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(nonce,rahasia())).replace(/=+$/,'');}
function sama(a,b){
  a=String(a);b=String(b);
  if(a.length!==b.length)return false;
  var d=0;for(var i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);
  return d===0;
}

/* Jalankan SEKALI dari editor: membuat sheet dan kunci rahasia. Aman dijalankan ulang. */
function siapkan(){
  var book=ss();
  Object.keys(HDR).forEach(function(nama){
    var sh=book.getSheetByName(nama)||book.insertSheet(nama);
    var h=HDR[nama];
    if(sh.getLastRow()===0){
      sh.getRange(1,1,1,h.length).setValues([h]);
      sh.getRange(1,1,1,h.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  var sw=book.getSheetByName(SH.siswa);
  sw.getRange('A:A').setNumberFormat('@');
  sw.getRange('D:D').setNumberFormat('@');
  rahasia();
  Logger.log('Siap. Isi sheet "Siswa" (kelas | absen | nama | pin), lalu Deploy sebagai Aplikasi web.');
}

/* Jalankan dari editor untuk menguji: catat kode cek() server di log, lalu bandingkan dengan halaman siswa. */
function ujiCek(){
  var t0=Date.now(),c=CORE.cek();
  Logger.log('cek() server  : '+c);
  Logger.log('VERSI         : '+CORE.VERSI);
  Logger.log('Waktu hitung  : '+(Date.now()-t0)+' ms');
  Logger.log('Bandingkan dengan hasil window.__api.CORE.cek() di konsol peramban halaman siswa. Keduanya harus sama persis.');
}

function doGet(e){
  return ContentService.createTextOutput(JSON.stringify({ok:true,layanan:'optimum',versi:CORE.VERSI,cek:cekServer()}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e){
  var out,lewatForm=!!(e&&e.parameter&&e.parameter.transport==='form');
  try{
    var raw=lewatForm?String(e.parameter.payload||''):((e&&e.postData&&e.postData.contents)||'');
    if(raw.length>400000)throw gagal('besar','Data terlalu besar.');
    var req;
    try{req=JSON.parse(raw);}catch(x){throw gagal('format','Permintaan tidak valid.');}
    if(!req||typeof req!=='object')throw gagal('format','Permintaan tidak valid.');
    if(req.action==='start')out=aksiMulai(req);
    else if(req.action==='simpan')out=aksiSimpan(req);
    else if(req.action==='submit')out=aksiKirim(req);
    else if(req.action==='ping')out={ok:true,layanan:'optimum',versi:CORE.VERSI,cek:cekServer()};
    else throw gagal('aksi','Aksi tidak dikenal.');
  }catch(err){
    if(err&&err.kode)out={ok:false,kode:err.kode,pesan:err.pesan};
    else{out={ok:false,kode:'galat',pesan:'Terjadi galat di server. Coba lagi atau hubungi gurumu.'};console.error(err&&err.stack?err.stack:err);}
  }
  if(lewatForm)return jawabForm(out,e.parameter);
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
/* Jawaban untuk SEB: formulir dikirim ke iframe tersembunyi, lalu hasilnya diteruskan lewat postMessage
   hanya ke asal halaman pengirim. */
function jawabForm(out,p){
  var rid=String(p.rid||''),asal=String(p.asal||'');
  if(!/^[A-Za-z0-9]{1,40}$/.test(rid)||!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(asal)){
    return ContentService.createTextOutput(JSON.stringify({ok:false,kode:'format',pesan:'Permintaan tidak valid.'})).setMimeType(ContentService.MimeType.JSON);
  }
  var aman=function(x){return JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');};
  return HtmlService.createHtmlOutput('<script>window.top.postMessage('+aman({optimumRid:rid,data:out})+','+aman(asal)+');<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

var _cekCache=null;
function cekServer(){
  if(_cekCache)return _cekCache;
  var c=CacheService.getScriptCache(),k='cek:'+CORE.VERSI,v=c.get(k);
  if(!v){v=CORE.cek();c.put(k,v,21600);}
  _cekCache=v;return v;
}
function cekToken(req){
  if(req.cek!==cekServer())throw gagal('versi','Halaman kuis tidak sama versinya dengan server. Muat ulang halaman; bila tetap begini, hubungi gurumu.');
  var token=String(req.token||''),bagian=token.split('.');
  if(bagian.length!==2||!sama(bagian[1],tanda(bagian[0])))throw gagal('token','Token tidak valid.');
  return bagian[0];
}
/* mencari baris sesi berdasarkan nonce (kolom A) tanpa membaca seluruh sheet */
function cariSesi(sesi,nonce){
  var n=sesi.getLastRow();if(n<2)return null;
  var r=sesi.getRange(2,1,n-1,1).createTextFinder(nonce).matchEntireCell(true).findNext();
  if(!r)return null;
  return {baris:r.getRow(),row:sesi.getRange(r.getRow(),1,1,HDR.Sesi.length).getValues()[0]};
}
function jejakTersimpan(row){try{var j=JSON.parse(row[COL_SESI.progres]||'[]');return Array.isArray(j)?j:[];}catch(x){return [];}}

/* ---------- siswa masuk: menerbitkan sesi bertanda tangan ---------- */
function aksiMulai(req){
  var materi=String(req.materi||'');
  if(!MATERI[materi])throw gagal('materi','Materi tidak dikenal.');
  if(req.cek!==cekServer())throw gagal('versi','Halaman kuis tidak sama versinya dengan server. Muat ulang halaman; bila tetap begini, hubungi gurumu.');
  var kelas=norm(req.kelas),absen=parseInt(req.absen,10),pin=String(req.pin==null?'':req.pin).trim(),nama=String(req.nama||'').trim().slice(0,40);
  if(!kelas||!(absen>=1&&absen<=99))throw gagal('data','Isi kelas dan nomor absen dengan benar.');
  var cache=CacheService.getScriptCache(),kunci='gagal:'+kelas+':'+absen;
  if(Number(cache.get(kunci)||0)>=KONFIG.MAKS_SALAH_PIN)throw gagal('kunci','Terlalu banyak PIN salah. Coba lagi beberapa menit lagi atau minta bantuan gurumu.');

  var daftar=lembar(SH.siswa).getDataRange().getValues().slice(1).filter(function(r){return String(r[0])!==''||String(r[1])!=='';});
  if(daftar.length){
    var s=null;
    for(var i=0;i<daftar.length;i++){if(norm(daftar[i][0])===kelas&&parseInt(daftar[i][1],10)===absen){s=daftar[i];break;}}
    if(!s||!sama(String(s[3]).trim(),pin)){
      cache.put(kunci,String(Number(cache.get(kunci)||0)+1),KONFIG.KUNCI_MENIT*60);
      throw gagal('masuk','Kelas, nomor absen, atau PIN tidak cocok.');
    }
    nama=String(s[2]||('No. '+absen));
  }else if(!nama)throw gagal('nama','Isi nama atau inisial.');

  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    var sesi=lembar(SH.sesi),data=sesi.getDataRange().getValues(),now=agora(),mine=[],terbuka=null,kadaluwarsa=false;
    for(var r=1;r<data.length;r++){
      var row=data[r];
      if(row[COL_SESI.materi]===materi&&norm(row[COL_SESI.kelas])===kelas&&parseInt(row[COL_SESI.absen],10)===absen){
        mine.push(r);
        if(row[COL_SESI.status]==='mulai'){
          if(Number(row[COL_SESI.batas])>now)terbuka=r;else kadaluwarsa=true;
        }
      }
    }
    if(terbuka!==null){
      if(!KONFIG.IZIN_LANJUT)throw gagal('lanjut','Kuismu sebelumnya belum selesai. Minta gurumu membukanya kembali.');
      var rw=data[terbuka],jml=Number(rw[COL_SESI.lanjut]||0)+1;
      sesi.getRange(terbuka+1,COL_SESI.lanjut+1).setValue(jml);
      return jawabMulai(rw,true,KONFIG.MAKS_PERCOBAAN-mine.length);
    }
    if(mine.length>=KONFIG.MAKS_PERCOBAAN){
      throw gagal('sudah',kadaluwarsa?'Waktu kuismu sebelumnya sudah habis. Minta gurumu membuka kembali.':'Kamu sudah mengerjakan kuis ini.');
    }
    var nonce=Utilities.getUuid(),seed=Math.floor(Math.random()*2147483646)+1;
    var baru=[nonce,materi,kelas,absen,nama,seed,now,now+KONFIG.BATAS_MENIT*60000,'mulai','','','',tanggal(now),0,'',''];
    sesi.appendRow(baru);
    return jawabMulai(baru,false,KONFIG.MAKS_PERCOBAAN-mine.length-1);
  }finally{lock.releaseLock();}
}
function jawabMulai(r,lanjut,sisa){
  return {ok:true,token:r[COL_SESI.nonce]+'.'+tanda(r[COL_SESI.nonce]),seed:Number(r[COL_SESI.seed]),nama:String(r[COL_SESI.nama]),
    batasMenit:KONFIG.BATAS_MENIT,sisaDetik:Math.max(0,Math.floor((Number(r[COL_SESI.batas])-agora())/1000)),
    lanjut:!!lanjut,jejak:(lanjut&&KONFIG.SIMPAN_PROGRES)?jejakTersimpan(r):[],sisaPercobaan:Math.max(0,sisa)};
}

/* ---------- menyimpan progres: dipanggil halaman setiap kali siswa mencoba satu langkah ---------- */
function aksiSimpan(req){
  if(!KONFIG.SIMPAN_PROGRES)return {ok:true,nonaktif:true};
  var nonce=cekToken(req),jejak=req.trace;
  if(!Array.isArray(jejak)||jejak.length>KONFIG.MAKS_PERISTIWA)throw gagal('jejak','Jejak jawaban tidak valid.');
  var teks=JSON.stringify(jejak);
  if(teks.length>45000)throw gagal('jejak','Jejak jawaban terlalu panjang.');
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))throw gagal('sibuk','Server sedang sibuk. Jawabanmu akan disimpan ulang otomatis.');
  try{
    var sesi=lembar(SH.sesi),f=cariSesi(sesi,nonce);
    if(!f)throw gagal('token','Sesi tidak ditemukan.');
    var row=f.row,now=agora();
    if(row[COL_SESI.status]==='selesai')return {ok:true,selesai:true};
    if(now>Number(row[COL_SESI.batas])+KONFIG.TOLERANSI_MENIT*60000)throw gagal('habis','Waktu kuis sudah habis.');
    var g;
    try{g=MATERI[String(row[COL_SESI.materi])].nilai(MATERI[String(row[COL_SESI.materi])].bangun(Number(row[COL_SESI.seed])),jejak);}catch(x){throw gagal('jejak','Jejak jawaban tidak valid.');}
    var lama=jejakTersimpan(row);
    if(jejak.length<lama.length)return {ok:true,done:g.done,abaikan:true};   /* permintaan lama yang datang terlambat */
    sesi.getRange(f.baris,COL_SESI.progres+1,1,2).setValues([[teks,tanggal(now)]]);
    return {ok:true,done:g.done};
  }finally{lock.releaseLock();}
}

/* ---------- siswa selesai: server MENILAI ULANG dari jawaban mentah ---------- */
function aksiKirim(req){
  var nonce=cekToken(req),jejak=req.trace;
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    var sesi=lembar(SH.sesi),data=sesi.getDataRange().getValues(),idx=-1;
    for(var r=1;r<data.length;r++){if(data[r][COL_SESI.nonce]===nonce){idx=r;break;}}
    if(idx<0)throw gagal('token','Sesi tidak ditemukan.');
    var row=data[idx],now=agora(),materi=String(row[COL_SESI.materi]);
    if(row[COL_SESI.status]==='selesai'){
      var lama=JSON.parse(row[COL_SESI.hasil]||'{}');lama.ulang=true;return lama;   /* idempoten: kirim ulang tidak mengubah apa pun */
    }
    if(now>Number(row[COL_SESI.batas])+KONFIG.TOLERANSI_MENIT*60000)throw gagal('habis','Waktu kuis sudah habis sehingga skor tidak dapat disetor. Minta gurumu membuka kembali.');
    if(!Array.isArray(jejak)||jejak.length>KONFIG.MAKS_PERISTIWA)throw gagal('jejak','Jejak jawaban tidak valid.');
    var m=MATERI[materi];
    var pack=m.bangun(Number(row[COL_SESI.seed]));
    var g;
    try{g=m.nilai(pack,jejak);}catch(x){throw gagal('jejak','Jejak jawaban tidak valid.');}

    var durasi=Math.round((now-Number(row[COL_SESI.mulai]))/1000),cat=[];
    if(!g.complete)cat.push('tidak lengkap ('+g.done+' dari '+g.total+' langkah)');
    if(durasi<g.done*KONFIG.MIN_DETIK_PER_LANGKAH)cat.push('terlalu-cepat');
    if(g.ignored>0)cat.push(g.ignored+' jawaban diabaikan');
    if(!g.monotonic)cat.push('waktu-jejak-tidak-urut');
    var kl=req.klaim;
    if(kl&&(kl.skor!==g.score||kl.maks!==g.max))cat.push('skor-klien-beda');
    var lanjut=Number(row[COL_SESI.lanjut]||0);
    if(lanjut>0)cat.push('dilanjutkan '+lanjut+' kali');

    var persen=g.max?Math.round(100*g.score/g.max):0,lemah=Object.keys(g.missed);
    var kelas=row[COL_SESI.kelas],absen=row[COL_SESI.absen],nama=row[COL_SESI.nama];
    var sisa=KONFIG.MAKS_PERCOBAAN;
    for(var q=1;q<data.length;q++){
      var d=data[q];
      if(d[COL_SESI.materi]===materi&&norm(d[COL_SESI.kelas])===norm(kelas)&&parseInt(d[COL_SESI.absen],10)===parseInt(absen,10))sisa--;
    }
    var hasil={ok:true,skor:g.score,maks:g.max,persen:persen,rinci:g.rinci,perluDiperkuat:lemah,sisaPercobaan:Math.max(0,sisa)};
    var rin=RINCI.map(function(k){return g.rinci[k][0];});   /* angka saja; maksimumnya tertulis di judul kolom */

    lembar(SH.skor).appendRow([tanggal(now),kelas,absen,nama,materi,g.score,g.max,persen].concat(rin,[durasi,lemah.join('; '),cat.join('; '),nonce]));
    lembar(SH.jejak).appendRow([nonce,tanggal(now),JSON.stringify(jejak).slice(0,45000)]);
    sesi.getRange(idx+1,COL_SESI.status+1,1,4).setValues([['selesai',g.score,g.max,JSON.stringify(hasil)]]);
    return hasil;
  }finally{lock.releaseLock();}
}
