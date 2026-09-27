(async () => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const cloudApiBase = String(window.SYNTAX_STUDIO_API_URL || '').replace(/\/$/, '');
  const driveApiUrl = String(window.SYNTAX_STUDIO_DRIVE_URL || '').trim();
  const driveApiVersion = 2;
  const drivePasswordKey = 'syntaxStudio.driveAdminPassword';
  const getDrivePassword = () => { try { return sessionStorage.getItem(drivePasswordKey) || ''; } catch { return ''; } };
  function inferMimeType(file) { return file?.type||(/\.pdf$/i.test(file?.name||'')?'application/pdf':/\.png$/i.test(file?.name||'')?'image/png':/\.(jpe?g)$/i.test(file?.name||'')?'image/jpeg':''); }
  let preSyncAssignments=[];
  try { preSyncAssignments=JSON.parse(localStorage.getItem('syntaxStudio.assignments')||'[]'); } catch {}
  const adminTokenKey = 'syntaxStudio.adminToken';
  const getAdminToken = () => { try { return localStorage.getItem(adminTokenKey) || ''; } catch { return ''; } };
  let cloudStatusText = (driveApiUrl || cloudApiBase) ? 'Connecting to shared storage...' : 'Browser-only storage (cloud sync not configured)';
  function showCloudStatus(message, error=false) { cloudStatusText=message; const node=$('#cloudStatus'); if(node){node.textContent=message;node.classList.toggle('error',error);} }
  async function blobToBase64(file) { const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(binary); }
  async function driveFileBlob(id) { const result=await driveJsonp({action:'file',id}),raw=atob(result.file.data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new Blob([bytes],{type:result.file.mimeType||'application/octet-stream'}); }
  function driveJsonp(params) {
    return new Promise((resolve,reject)=>{
      const callback=`syntaxDriveCallback${Date.now()}${Math.floor(Math.random()*10000)}`;
      const script=document.createElement('script'); const timeout=setTimeout(()=>finish(new Error('Drive request timed out')),20000);
      function finish(error,value){clearTimeout(timeout);delete window[callback];script.remove();error?reject(error):resolve(value);}
      window[callback]=value=>value?.ok?finish(null,value):finish(new Error(value?.error||'Drive request failed'));
      script.onerror=()=>finish(new Error('Could not reach the Google Drive storage app'));
      script.src=`${driveApiUrl}?${new URLSearchParams({...params,callback})}`;document.head.append(script);
    });
  }
  function drivePost(payload) {
    const probe=`${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const body=new URLSearchParams({payload:JSON.stringify({...payload,probe})});
    return fetch(driveApiUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body})
      .then(async()=>{
        for(let attempt=0;attempt<20;attempt++){
          await new Promise(resolve=>setTimeout(resolve,500));
          const result=await driveJsonp({action:'receipt',probe});
          if(result.receipt){if(!result.receipt.ok)throw new Error(result.receipt.error||'Drive rejected the request');return result.receipt;}
        }
        throw new Error('Google Drive did not confirm the request. Update the Apps Script deployment to the latest version and try again.');
      });
  }
  async function loadDriveState() {
    if(!driveApiUrl)return;
    const response=await driveJsonp({action:'state'}),state=response.state||{};
    if(Array.isArray(state.assignments))localStorage.setItem('syntaxStudio.assignments',JSON.stringify(state.assignments));
    if(state.examConfig)localStorage.setItem('syntaxStudio.examConfig',JSON.stringify(state.examConfig));
    if(response.apiVersion!==driveApiVersion)showCloudStatus('Drive backend is outdated — redeploy Code.gs v2.',true);
    else showCloudStatus('Google Drive connected');return state;
  }
  async function syncDriveState() {
    const state={assignments:store.get('assignments',[]),examConfig:store.get('examConfig',null)},files=[];
    for(const item of state.assignments||[]){
      const ref=item.questionPdf;if(!ref?.id)continue;
      const file=await attachmentDB.get(ref.id);if(!file)continue;
      files.push({id:ref.id,name:ref.name||file.name,mimeType:ref.mimeType||inferMimeType(file)||'application/pdf',data:await blobToBase64(file)});
    }
    for(const question of state.examConfig?.questions||[]){
      const ref=question.image;if(!ref?.id)continue;
      const file=await attachmentDB.get(ref.id);if(!file)continue;
      files.push({id:ref.id,name:ref.name||file.name,mimeType:ref.mimeType||inferMimeType(file),data:await blobToBase64(file)});
    }
    showCloudStatus('Saving to Google Drive...');
    await drivePost({action:'save',password:getDrivePassword(),state,files});
    showCloudStatus('Saved to Google Drive');
  }
  async function loadDriveSubmissions() {
    if(!driveApiUrl||!getDrivePassword())return;
    const result=await drivePost({action:'getSubmissions',password:getDrivePassword()});
    submissions={...submissions,...(result.submissions||{})};store.set('submissions',submissions);
  }
  async function cloudFetch(path, options={}) {
    const response=await fetch(`${cloudApiBase}${path}`,{...options,headers:{...(options.headers||{}),...(getAdminToken()?{Authorization:`Bearer ${getAdminToken()}`}:{})}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||`Cloud request failed (${response.status})`);
    return body;
  }
  async function cloudFileFetch(path, options={}) {
    const response=await fetch(`${cloudApiBase}${path}`,{...options,headers:{...(options.headers||{}),...(getAdminToken()?{Authorization:`Bearer ${getAdminToken()}`}:{})}});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`Cloud request failed (${response.status})`);}
    return response;
  }
  async function loadCloudState(admin=false) {
    if(driveApiUrl)return loadDriveState();
    if(!cloudApiBase)return;
    try{
      const state=await cloudFetch(admin?'/api/admin/state':'/api/state');
      if(Array.isArray(state.assignments)){localStorage.setItem('syntaxStudio.assignments',JSON.stringify(state.assignments));}
      if(state.examConfig)localStorage.setItem('syntaxStudio.examConfig',JSON.stringify(state.examConfig));
      showCloudStatus('GitHub course data connected');
      return state;
    }catch(error){
      if(admin&&/expired|login/i.test(error.message)){localStorage.removeItem(adminTokenKey);}
      showCloudStatus('Cloud unavailable - changes may stay on this device',true);
      throw error;
    }
  }
  async function syncRemoteKey(key,value) {
    if(driveApiUrl){if(getDrivePassword()&&['assignments','examConfig'].includes(key))return syncDriveState();return;}
    if(!cloudApiBase||!getAdminToken()||!['assignments','examConfig'].includes(key))return;
    let path='/api/admin/assignments',payload={assignments:value};
    if(key==='examConfig'){
      path='/api/admin/exam-config';
      payload={examConfig:await Promise.all((value.questions||[]).map(async question=>{
        if(!question.image?.id)return question;
        const file=await attachmentDB.get(question.image.id);
        if(file)await cloudFileFetch(`/api/admin/files/${encodeURIComponent(question.image.id)}`,{method:'PUT',headers:{'Content-Type':question.image.mimeType||file.type||'image/png'},body:file});
        return {...question,image:{id:question.image.id,name:question.image.name,mimeType:question.image.mimeType||file?.type||'image/png',uploadedAt:question.image.uploadedAt||Date.now()}};
      }))};
    }
    else payload.assignments=await Promise.all(value.map(async item=>{
      if(!item.questionPdf?.id)return item;
      const file=await attachmentDB.get(item.questionPdf.id);
      if(file)await cloudFileFetch(`/api/admin/files/${encodeURIComponent(item.questionPdf.id)}`,{method:'PUT',headers:{'Content-Type':item.questionPdf.mimeType||file.type||'application/pdf'},body:file});
      return {...item,questionPdf:{id:item.questionPdf.id,name:item.questionPdf.name,mimeType:item.questionPdf.mimeType||file?.type||'application/pdf',uploadedAt:item.questionPdf.uploadedAt||Date.now()}};
    }));
    showCloudStatus('Saving to private GitHub storage...');
    await cloudFetch(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    showCloudStatus('Saved to private GitHub storage');
  }
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(`syntaxStudio.${key}`)) ?? fallback; } catch { return fallback; } },
    set(key, value) {
      try { localStorage.setItem(`syntaxStudio.${key}`, JSON.stringify(value)); }
      catch { showCloudStatus('This browser could not save a local copy',true); }
      if(driveApiUrl&&getDrivePassword()&&['assignments','examConfig'].includes(key))syncRemoteKey(key,value).catch(error=>showCloudStatus(`Drive save failed: ${error.message}`,true));
      else if(cloudApiBase&&getAdminToken()&&['assignments','examConfig'].includes(key))syncRemoteKey(key,value).catch(error=>showCloudStatus(`GitHub save failed: ${error.message}`,true));
    }
  };
  const attachmentDB = (() => {
    let dbPromise;
    return {
      open() {
        if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open('syntaxStudioFiles', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('files');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return dbPromise;
      },
      async put(id, file) { const db = await this.open(); return new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); },
      async get(id) { const db = await this.open(); return new Promise((resolve,reject)=>{const req=db.transaction('files').objectStore('files').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); },
      async delete(id) { const db = await this.open(); return new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); }
    };
  })();
  if(driveApiUrl||cloudApiBase){
    try{await loadCloudState(Boolean(getAdminToken()));}
    catch{if(!getAdminToken())try{await loadCloudState(false);}catch{}}
  }
  const topics = [
    { id:'lexical', title:'Lexical Analysis', icon:'Aa', time:'12 min', level:'Foundations', intro:'How a compiler turns a stream of characters into meaningful tokens.', description:'Explore the scanner’s role in a compiler front end, how lexemes become tokens, and the regular-expression ideas used to describe token patterns.', sections:[['The compiler front end','A compiler processes source code in stages. The lexical analyzer (scanner) reads the character stream and groups it into lexemes, passing token records to the syntax analyzer.'],['Tokens, lexemes & patterns','A token is a category such as IDENTIFIER or NUMBER; a lexeme is the actual character sequence, such as count or 42. A pattern describes which lexemes belong to a token.'],['What the scanner handles','Whitespace and comments are usually skipped. The scanner can track line numbers, report invalid character sequences, and use lookahead to choose the longest valid token.'],['Regular expressions','Regular expressions describe token patterns. For example, a letter followed by zero or more letters or digits can describe a simple identifier. Finite automata can recognize these regular languages efficiently.']], practice:{q:'In the source `total = 42`, what is `total` to the lexical analyzer?',opts:['A lexeme recognized as an identifier token','A grammar production','A parse-tree node'],answer:0,explain:'The character sequence total is the lexeme; the scanner classifies it as an identifier token.'}},
    { id:'syntax', title:'Syntax Analysis', icon:'{}', time:'15 min', level:'Foundations', intro:'How a parser checks token order against a context-free grammar.', description:'Connect tokens to grammar productions, parse trees and bottom-up shift-reduce parsing. This is the foundation for the LR methods in the next gate.', sections:[['From tokens to structure','The parser consumes tokens from the lexical analyzer and checks whether their order is generated by a context-free grammar (CFG).'],['Context-free grammars','A CFG has terminals, nonterminals, a start symbol and productions. For example, E → E + T | T describes expressions built from terms and addition.'],['Parse trees & derivations','A parse tree shows how a start symbol derives an input. Leftmost and rightmost derivations expand nonterminals in different orders; ambiguity occurs when one input has more than one parse tree.'],['Shift-reduce parsing','A bottom-up parser shifts input symbols onto a stack and reduces recognized handles to nonterminals until it reaches the start symbol. LR parsers make these choices using parser states and lookahead.']], practice:{q:'What does a syntax analyzer receive from the lexical analyzer?',opts:['A stream of tokens','Raw source characters only','Machine instructions'],answer:0,explain:'The scanner groups characters into tokens; the parser checks the sequence against the grammar.'}},
    { id:'lr', title:'LR Parsing: LR(0), SLR(1) & CLR(1)', icon:'LR', time:'20 min', level:'Parsing methods', intro:'Build LR item sets and see how lookahead changes parsing decisions.', description:'Compare the LR-family table construction methods called out in your brief: LR(0), SLR(1), and CLR(1) (canonical LR(1)).', sections:[['LR items & the dot','An LR item marks parser progress through a production. In A → X · Y, the dot says X has been recognized and Y is expected next. The closure and goto operations build item sets (states).'],['LR(0) tables','LR(0) item sets have no lookahead attached to completed items. A completed item can request a reduction in every terminal column, so grammars may produce shift/reduce or reduce/reduce conflicts.'],['SLR(1) tables','SLR uses the same LR(0) states, but limits a completed A → α reduction to terminals in FOLLOW(A). This extra context can resolve conflicts, though FOLLOW sets are global and can be too broad.'],['CLR(1) / canonical LR(1)','Canonical LR(1) items include a lookahead terminal, written [A → α · β, a]. Reductions are limited to that lookahead. This context-sensitive precision handles more grammars, usually with more states.'],['Compare the methods','All three use shift, reduce, accept and error actions. LR(0) uses no lookahead on reductions; SLR(1) uses FOLLOW sets; CLR(1) carries lookahead in each item. A conflict means the table cannot choose a unique action.']], practice:{q:'A completed item A → α is ready to reduce. Which method uses FOLLOW(A) to choose the reduction columns?',opts:['LR(0)','SLR(1)','CLR(1)'],answer:1,explain:'SLR(1) places the reduction in FOLLOW(A) columns. CLR(1) instead uses the lookahead attached to each LR(1) item.'}}
  ];
  const imageLessons=[
    {n:1,image:'Screenshot 2026-09-26 210300.png',title:'LR item types',display:['Shift item: X → α · t β','State item: X → α · Y β','Reduced item: X → α ·','Accept item: S′ → S ·'],prompt:'Which item is the accept item?',options:['X → α · t β','S′ → S ·','X → α · Y β'],answer:1,summary:'Only the augmented start item S′ → S · signals acceptance.',steps:[['Read the dot','The dot records how much of a production has been recognized.'],['Classify each shape','A terminal after the dot means shift; a nonterminal after it means a state transition; a dot at the end means reduce.'],['Identify acceptance','The completed augmented production S′ → S · is the special accept item.']]},
    {n:2,image:'Screenshot 2026-09-26 210347.png',title:'GOTO(I₀, A) and the six-state DFA',display:['S′ → S','S → AB','A → a','B → b'],prompt:'After moving the dot over A, what is |GOTO(I₀, A)|?',options:['1 item','2 items','3 items'],answer:1,summary:'GOTO(I₀,A) = {S → A·B, B → ·b}, so its size is 2. The full DFA has six states.',steps:[['Augment','Add S′ → S. The initial kernel is S′ → ·S.'],['Close I₀','Add S → ·AB and A → ·a. B is not added because the dot is before A.'],['Move over A','The kernel item becomes S → A·B. Since B follows the dot, closure adds B → ·b.'],['Count and finish','There are two items in this GOTO set. Following every transition gives I₀ through I₅: six states.']]},
    {n:3,image:'Screenshot 2026-09-26 210404.png',title:'Question 2 · Four-state LR(0) grammar',display:['S → Sa','S → b'],prompt:'Does this grammar have an LR(0) conflict?',options:['Yes, shift/reduce','Yes, reduce/reduce','No conflict: LR(0)'],answer:2,summary:'The notes construct four states and find no conflict; the grammar is LR(0).',steps:[['Augment and close','I₀ = {S′ → ·S, S → ·Sa, S → ·b}.'],['Follow the transitions','GOTO on S contains S′ → S· and S → S·a; the a and b paths complete their productions.'],['Check actions','The accept item does not conflict with the shift item, and no state has two completed items.'],['Conclude','There are four states and no LR(0) conflict.']]},
    {n:4,image:'Screenshot 2026-09-26 210415.png',title:'Question 3 · Reduce/reduce conflict',display:['S → aA','S → aB','A → f','B → f'],prompt:'What happens in the state reached after f?',options:['One reduction','A reduce/reduce conflict','A shift/reduce conflict'],answer:1,summary:'The state contains both A → f· and B → f·, so two reductions compete.',steps:[['Share the prefix','Both start productions begin with a. After reading a, the state expects either A or B.'],['Complete both paths','A and B each derive f, so the transition on f places A → f· and B → f· together.'],['Classify','Two completed items in one state create a reduce/reduce conflict. The grammar is not LR(0).']]},
    {n:5,image:'Screenshot 2026-09-26 210426.png',title:'Question 4 · Left-recursive concatenation',display:['S → SS','S → a'],prompt:'Why is S → SS | a not LR(0)?',options:['Reduce/reduce conflict','Shift/reduce conflict','No conflict'],answer:1,summary:'A state can contain S → SS· together with items that can shift a: an LR(0) shift/reduce conflict.',steps:[['Build the recursive state','After recognizing S, closure adds S → ·SS and S → ·a, while S → S·S records progress.'],['Read another S','A state reached after the second S contains the completed item S → SS· and can still shift a.'],['Classify','The same state offers reduce and shift actions, so the grammar is not LR(0). The notes mark five inadequate states.']]},
    {n:6,image:'Screenshot 2026-09-26 210437.png',title:'Question 5 · Empty production',display:['S → a','S → ε'],prompt:'Why does the initial LR(0) state conflict?',options:['Accept and reduce','Shift a and reduce S → ε','Two reductions'],answer:1,summary:'I₀ has S → ·a and completed S → ·, so LR(0) can shift a or reduce the empty rule.',steps:[['Remember epsilon','S → ε is represented by a completed item S → ·; no input symbol is consumed.'],['Inspect I₀','The state also contains S → ·a, which asks the parser to shift a.'],['Classify','Shift and reduce are both possible in I₀, making this grammar not LR(0).']]},
    {n:7,image:'Screenshot 2026-09-26 210450.png',title:'Question 6 · Disjoint FOLLOW sets',display:['S → Aa','S → Bb','A → f','B → f'],prompt:'Can SLR(1) resolve the LR(0) reduce/reduce conflict?',options:['Yes: FOLLOW(A)={a}, FOLLOW(B)={b}','No: both FOLLOW sets are {$}','No: SLR has no lookahead'],answer:0,summary:'The LR(0) state has A → f· and B → f·, but SLR uses disjoint FOLLOW sets {a} and {b}, so it resolves the conflict.',steps:[['Find the LR(0) state','Both A and B derive f, placing A → f· and B → f· in one state.'],['Compute FOLLOW','A is followed by a; B is followed by b. Thus FOLLOW(A)={a} and FOLLOW(B)={b}.'],['Apply SLR','Each reduction appears in a different lookahead column. There is no reduce/reduce conflict in SLR(1).']]},
    {n:8,image:'Screenshot 2026-09-26 210459.png',title:'Question 7 · Overlapping FOLLOW sets',display:['S → Aa','S → Bb','S → cAb','A → f','B → f'],prompt:'Do the SLR reduction lookaheads overlap?',options:['No, their intersection is empty','Yes, both include b','Only FOLLOW(A) includes b'],answer:1,summary:'FOLLOW(A)={a,b} and FOLLOW(B)={b}; the shared b keeps the reduce/reduce conflict in SLR(1).',steps:[['Locate the completed items','The f transition puts A → f· and B → f· in the same LR(0) state.'],['Compute FOLLOW(A)','A is followed by a in Aa and by b in cAb, so FOLLOW(A)={a,b}.'],['Compute FOLLOW(B)','B is followed by b, so FOLLOW(B)={b}. Their intersection is {b}.'],['Conclude','Both reductions compete on b. The grammar is neither LR(0) nor SLR(1).']]},
    {n:9,image:'Screenshot 2026-09-26 210534.png',title:'LR(0) DFA: closure, transitions and accept',display:['S′ → S','S → AB','A → a','B → b'],prompt:'Which statement about S′ → S· is correct?',options:['It is a reduce item that causes RR conflict','It is the accept item and does not participate in conflicts','It must reduce on every terminal'],answer:1,summary:'S′ → S· is the accept item. The diagram has six states, and this grammar is LR(0), hence SLR(1).',steps:[['Start with the augmented item','I₀ is the closure of S′ → ·S, adding S → ·AB and A → ·a.'],['Follow GOTO','Transitions on S, A, a, B and b produce I₁ through I₅.'],['Recognize acceptance','The state with S′ → S· accepts; it is not treated as an ordinary reduction conflict.'],['Count','The DFA contains six states. No conflicts occur.']]},
    {n:10,image:'Screenshot 2026-09-26 210554.png',title:'Question 6 · LR(0) versus SLR(1)',display:['S → Aa','S → Bb','A → f','B → f','FOLLOW(A)={a}, FOLLOW(B)={b}'],prompt:'Which parser classes accept this grammar?',options:['LR(0) and SLR(1)','Not LR(0), but SLR(1)','Neither LR(0) nor SLR(1)'],answer:1,summary:'LR(0) has a reduce/reduce conflict, but disjoint FOLLOW sets remove it in SLR(1).',steps:[['Build the LR(0) automaton','The shared f state contains two completed items, so LR(0) conflicts.'],['Use the FOLLOW sets','A reduces on a and B reduces on b. The lookaheads are disjoint.'],['Conclude','This grammar is not LR(0), but it is SLR(1).']]},
    {n:11,image:'Screenshot 2026-09-26 210604.png',title:'Question 7 · FOLLOW overlap defeats SLR',display:['S → Aa','S → Bb','S → cAb','A → f','B → f'],prompt:'What causes the SLR(1) reduce/reduce conflict?',options:['FOLLOW(A) ∩ FOLLOW(B) = {b}','FOLLOW(A) ∩ FOLLOW(B) = ∅','There is a shift on f'],answer:0,summary:'The two reductions overlap on b because b belongs to both FOLLOW(A) and FOLLOW(B).',steps:[['Find the shared state','The state after f contains A → f· and B → f·.'],['Find the lookaheads','FOLLOW(A)={a,b}; FOLLOW(B)={b}.'],['Apply the conflict rule','Their intersection is not empty: b. Both reductions are entered under b, so this grammar is not SLR(1).']]},
    {n:12,image:'Screenshot 2026-09-26 210615.png',title:'Question 8 · Shift/reduce on b',display:['S → AB','S → ab','A → a','B → b'],prompt:'Why does SLR(1) still have a conflict after reading a?',options:['b ∈ FOLLOW(A), so reduce A → a collides with shift b','FOLLOW(A) is empty','There are two completed items'],answer:0,summary:'The state has S → a·b and A → a·. Since b ∈ FOLLOW(A), SLR keeps the shift/reduce conflict.',steps:[['Read a','GOTO(I₀,a) contains S → a·b and A → a·.'],['See the LR(0) choice','The first item shifts b; the second reduces A → a.'],['Check FOLLOW(A)','A is followed by B in S → AB, and FIRST(B)={b}; therefore b ∈ FOLLOW(A).'],['Conclude','SLR places the reduction on b, so the grammar is not SLR(1).']]},
    {n:13,image:'Screenshot 2026-09-26 210625.png',title:'Question 9 · Parentheses, concatenation and ε',display:['S → SS','S → (S)','S → ε','FOLLOW(S)={ $, (, ) }'],prompt:'Is the grammar LR(0) or SLR(1)?',options:['LR(0) and SLR(1)','Not LR(0), but SLR(1)','Neither LR(0) nor SLR(1)'],answer:2,summary:'The empty-production reductions overlap with shifts on terminals in FOLLOW(S), so both methods conflict.',steps:[['Build the initial closure','It includes S′ → ·S, S → ·SS, S → ·(S), and the completed empty item S → ·.'],['Find LR(0) conflict','The state can shift `(` and reduce S → ε.'],['Apply SLR lookahead','FOLLOW(S) contains $, `(` and `)`; the reduction on `(` still collides with its shift.'],['Conclude','The notes identify five inadequate states and mark the grammar not LR(0) and not SLR(1).']]},
    {n:14,image:'Screenshot 2026-09-26 210636.png',title:'Question 10 · Empty A, recursive B',display:['S → aA','S → bB','A → ε','B → bA'],prompt:'How is this grammar classified?',options:['LR(0) and SLR(1)','Not LR(0), but SLR(1)','Not SLR(1)'],answer:0,summary:'The grammar is LR(0), therefore it is also SLR(1). The empty A item is in a state without a competing shift.',steps:[['Initial state','I₀ has S′ → ·S, S → ·aA and S → ·bB.'],['After a','The state has S → a·A and completed A → ·; no terminal shift competes there.'],['After b','The state has S → b·B and B → ·bA. The b transition advances the recursive production.'],['Conclude','No LR(0) state contains a shift/reduce or reduce/reduce conflict.']]},
    {n:15,image:'Screenshot 2026-09-26 210650.png',title:'General SLR(1) conflict rules',display:['Build the LR(0) DFA first','Shift/reduce: shift terminal t ∈ FOLLOW(reduced lhs)','Reduce/reduce: FOLLOW(X) ∩ FOLLOW(Y) ≠ ∅'],prompt:'When does an LR(0) shift/reduce pair remain a conflict in SLR(1)?',options:['Whenever any completed item exists','When the shift terminal belongs to FOLLOW(lhs of the reduction)','Only when FOLLOW is empty'],answer:1,summary:'SLR retains the conflict when the terminal on the shift item is in FOLLOW of the completed production’s left-hand side.',steps:[['Reuse LR(0) states','SLR(1) starts with the LR(0) DFA.'],['Restrict reductions','For X → α·, place the reduce action only in FOLLOW(X) columns.'],['Check collisions','If a shift terminal t is also in FOLLOW(X), both actions occupy the same cell. Two reductions conflict if their FOLLOW sets overlap.']]},
    {n:16,image:'Screenshot 2026-09-26 210702.png',title:'SLR shift/reduce condition',display:['Shift item: A → b · a','Reduced item: D → b ·','Conflict if a ∈ FOLLOW(D)'],prompt:'In this state, when do these items conflict under SLR(1)?',options:['If a ∈ FOLLOW(D)','If a ∉ FOLLOW(D)','Always, because the state has two items'],answer:0,summary:'The shift on a collides with reducing D → b when a belongs to FOLLOW(D).',steps:[['Identify actions','A → b·a requests a shift on a. D → b· requests reduction by D.'],['Use SLR lookahead','That reduction is entered only for terminals in FOLLOW(D).'],['Decide','There is an SLR shift/reduce conflict exactly when a ∈ FOLLOW(D).']]},
    {n:17,image:'Screenshot 2026-09-26 210714.png',title:'SLR reduce/reduce condition',display:['Completed item: X → α ·','Completed item: Y → β ·','Conflict if FOLLOW(X) ∩ FOLLOW(Y) ≠ ∅'],prompt:'What must be true for these two reductions to conflict in SLR(1)?',options:['Their FOLLOW sets overlap','Their FOLLOW sets are disjoint','Both productions have the same RHS'],answer:0,summary:'An overlapping terminal lookahead causes both completed items to request reductions in the same ACTION-table cell.',steps:[['Identify both reductions','The dot is at the end of each production, so each is ready to reduce.'],['Limit their columns','SLR uses FOLLOW(X) for the first reduction and FOLLOW(Y) for the second.'],['Check intersection','A reduce/reduce conflict exists if the FOLLOW sets share at least one terminal.']]},
    {n:18,image:'Screenshot 2026-09-26 210726.png',title:'LR(0), SLR(1), CLR(1) and LALR(1)',display:['LR(0) item: X → α · β','LR(1) item: [X → α · β, L]','CLR(1) and LALR(1) use LR(1) item sets'],prompt:'What extra information does a canonical LR(1) item contain?',options:['A global FOLLOW set','A lookahead set attached to the item','Only the transition state number'],answer:1,summary:'An LR(1) item pairs an LR(0) core with its lookahead set. CLR and LALR are based on LR(1) items.',steps:[['LR(0) item','The dot shows progress through a production, with no attached lookahead.'],['LR(1) item','The item adds a lookahead set L: [X → α·β, L].'],['Compare parser families','LR(0) and SLR(1) use LR(0) item sets. CLR(1) uses canonical LR(1) sets; LALR(1) also derives from LR(1) items.']]}
  ];
  let activeSlide=null,slideStep=0,slideChoice=null,animationTimer=null,animationPlaying=false,graphObserver=null;  const defaultAssignments = [];
  const defaultQuestions = [
    {id:'q1',q:'Which statement best describes the relationship between a lexeme and a token?',options:['A lexeme is the source text; a token is its category.','A token is a grammar; a lexeme is a parse table.','They are two names for a parser state.','A lexeme is a parser state; a token is a production.'],answer:0},
    {id:'q2',q:'In an LR item, what does the dot represent?',options:['The end of the input stream','How much of the production has been recognized','A reduce/reduce conflict','The next input token'],answer:1},
    {id:'q3',q:'Which parser table method places a completed production’s reduction in FOLLOW(A) columns?',options:['LR(0)','SLR(1)','CLR(1)','LALR(1)'],answer:1},
    {id:'q4',q:'What extra context is recorded in a canonical LR(1) item?',options:['A lookahead terminal','The complete source file','A regular expression','A parser stack'],answer:0},
    {id:'q5',q:'What is the main trade-off when using canonical LR(1) tables?',options:['Smaller tables with less context','More precise context, often with more states','No need for a grammar','Fewer lookahead symbols'],answer:1}
  ];
  let assignments = store.get('assignments', defaultAssignments);
  if(!Array.isArray(assignments))assignments=[];
  const priorDemoIds=new Set(['compiler-notes-set-1','starter-lex','starter-lr']);
  const cleanedAssignments=assignments.filter(item=>!priorDemoIds.has(item.id));
  if(cleanedAssignments.length!==assignments.length){assignments=cleanedAssignments;store.set('assignments',assignments);}
  let examConfig = store.get('examConfig', {title:'Parsing methods check-in',duration:15,opensAt:'',closesAt:'',locked:true,questions:defaultQuestions});
  let progress = store.get('progress', {});
  let submissions = store.get('submissions', {});
  let attempt = store.get('attempt', null);
  let teacherMode = false;
  let currentTopic = null;
  let importedQuestions = [];
  let toastTimeout;

  async function cleanupExpiredPdfs() {
    const files=store.get('attachmentMeta',[]),now=Date.now(),expired=files.filter(file=>file.expiresAt<=now);
    const hasExpiredLegacyPdf=Object.values(submissions).some(sub=>sub.file?.startsWith('data:application/pdf')&&now-sub.submittedAt>=10*24*60*60*1000);
    if(!expired.length&&!hasExpiredLegacyPdf)return;
    for(const file of expired){try{await attachmentDB.delete(file.id);}catch{}}
    store.set('attachmentMeta',files.filter(file=>file.expiresAt>now));
    assignments=assignments.map(item=>item.questionPdf&&expired.some(file=>file.id===item.questionPdf.id)?{...item,questionPdf:null}:item);
    store.set('assignments',assignments);
    for(const submission of Object.values(submissions)){
      if(submission.attachmentId&&expired.some(file=>file.id===submission.attachmentId)){submission.attachmentId='';submission.fileExpired=true;}
      if(submission.file?.startsWith('data:application/pdf')&&now-submission.submittedAt>=10*24*60*60*1000){submission.file='';submission.fileExpired=true;}
    }
    store.set('submissions',submissions);
  }
  function trackPdf(id,file){if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){const records=store.get('attachmentMeta',[]);records.push({id,expiresAt:Date.now()+10*24*60*60*1000});store.set('attachmentMeta',records);}}

  function toast(message) { const box=$('#toast'); box.textContent=message; box.classList.add('show'); clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>box.classList.remove('show'),2600); }
  function esc(value='') { return String(value).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function formatDate(value) { if(!value)return 'No due date'; const date=new Date(value); return Number.isNaN(date.getTime())?'No due date':`${date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})} IST`; }
  function setTeacher(value) { teacherMode=value; document.body.classList.toggle('teacher-mode',value); $('#teacherToggle').setAttribute('aria-pressed',String(value)); $('#teacherToggle').setAttribute('aria-label',value?'Close admin portal':'Open admin portal'); renderAssignments(); renderExam(); }
  async function adminLogin() {
    if(driveApiUrl){
      let password=getDrivePassword();
      if(!password){password=prompt('Google Drive admin password:');if(password===null)return;}
      try{
        const oldAssignments=store.get('assignments',[]).length?store.get('assignments',[]):preSyncAssignments;
        await drivePost({action:'login',password});
        sessionStorage.setItem(drivePasswordKey,password);
        const state=await loadDriveState();
        if(!(state.assignments||[]).length&&oldAssignments.length){localStorage.setItem('syntaxStudio.assignments',JSON.stringify(oldAssignments));await syncDriveState();}
        await loadDriveSubmissions();
        setTeacher(true);toast('Admin portal opened. Data is stored in Google Drive.');
      }catch(error){sessionStorage.removeItem(drivePasswordKey);if(/unknown action/i.test(error.message)){showCloudStatus('Drive API v2 is required. Check the deployed /exec URL and publish the latest Code.gs.',true);toast('Admin sign-in failed: Drive backend version mismatch.');}else toast(`Admin sign-in failed: ${error.message}`);}
      return;
    }
    if(cloudApiBase){
      if(getAdminToken()){
        try{await loadCloudState(true);setTeacher(true);toast('Admin portal opened.');return;}
        catch{localStorage.removeItem(adminTokenKey);}
      }
      const password=prompt('Admin password:');if(password===null)return;
      try{
        const login=await cloudFetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
        localStorage.setItem(adminTokenKey,login.token);
        const oldAssignments=store.get('assignments',[]),state=await loadCloudState(true);
        if(!localStorage.getItem('syntaxStudio.cloudMigrated')){
          if(!(state.assignments||[]).length&&oldAssignments.length){
            localStorage.setItem('syntaxStudio.assignments',JSON.stringify(oldAssignments));
            await syncRemoteKey('assignments',oldAssignments);
          }
          localStorage.setItem('syntaxStudio.cloudMigrated','true');
        }
        setTeacher(true);toast('Admin signed in. Course data is backed by GitHub.');
      }catch(error){localStorage.removeItem(adminTokenKey);toast(`Admin sign-in failed: ${error.message}`);}
      return;
    }
    const key='syntaxStudio.adminPassword'; let password;
    if(!localStorage.getItem(key)) {
      password=prompt('Create an admin password for this browser (8 characters minimum):');
      if(!password || password.length<8){toast('Admin password must be at least 8 characters.');return;}
      try{localStorage.setItem(key,password);}catch{toast('This browser cannot save the password.');return;}
      toast('Admin password created for this browser.'); setTeacher(true); return;
    }
    password=prompt('Admin password:');
    if(password===localStorage.getItem(key)) setTeacher(true); else if(password!==null) toast('Incorrect password.');
  }
  function navigate(view) { const names={home:'Overview',learn:'Learning path',scenario:'LR(0) scenario',assignments:'Assignments',exam:'Exam room'}; $$('.view').forEach(el=>el.classList.toggle('active',el.id===`${view}View`)); $$('.nav-item[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view)); $('#crumbTitle').textContent=names[view]||'Overview'; window.scrollTo({top:0,behavior:'smooth'}); if(view==='exam')renderExam(); if(view==='assignments'){if(driveApiUrl)loadDriveState().then(renderAssignments).catch(()=>renderAssignments());else renderAssignments();} }
  function topicCard(topic,compact=false) { const done=!!progress[topic.id]; return `<article class="topic-card" data-topic="${topic.id}"><div class="topic-top"><span class="topic-icon">${topic.icon}</span><span class="topic-index">${done?'✓ COMPLETE':topic.time.toUpperCase()}</span></div><h3>${topic.title}</h3><p>${topic.intro}</p><div class="topic-bottom"><span>${topic.level}</span><span>${done?'Review topic':'Explore topic'} →</span></div>${!compact?`<div class="tiny-progress"><span style="width:${done?100:0}%"></span></div>`:''}</article>`; }
  function renderTopics() { $('#homeTopics').innerHTML=topics.map(t=>topicCard(t)).join(''); $('#allTopics').innerHTML=topics.map((t,i)=>`<article class="topic-row"><span class="topic-icon">${t.icon}</span><div><h3>Gate ${String(i+1).padStart(2,'0')} · ${t.title}</h3><p>${t.description}</p><div class="topic-meta"><span>${t.time}</span><span>${t.level}</span><span>${progress[t.id]?'Completed':'Interactive lesson'}</span></div></div><button class="primary-button" data-topic="${t.id}">${progress[t.id]?'Review':'Start'} <span>→</span></button></article>`).join(''); $('#progressTotal').textContent=`${Object.values(progress).filter(Boolean).length} / ${topics.length} complete`; }
  function showTopic(id) { const topic=topics.find(t=>t.id===id); if(!topic)return; currentTopic=id; const body=topic.sections.map((section,i)=>`<section class="lesson-section"><span class="lesson-step">${String(i+1).padStart(2,'0')}</span><div><h3>${section[0]}</h3><p>${section[1]}</p></div></section>`).join(''); openModal(`<p class="eyebrow">GATE ${String(topics.indexOf(topic)+1).padStart(2,'0')} · ${esc(topic.level.toUpperCase())}</p><h2 id="modalTitle">${esc(topic.title)}</h2><p class="modal-intro">${esc(topic.description)}</p><div class="lesson-body">${body}<div class="practice-box"><p class="eyebrow">QUICK CHECK</p><b>${esc(topic.practice.q)}</b><div class="practice-options">${topic.practice.opts.map((o,i)=>`<button class="option" data-practice="${i}">${esc(o)}</button>`).join('')}</div><p class="practice-feedback" id="practiceFeedback"></p></div></div><div class="modal-actions"><button class="secondary-button" id="closeLesson">Close</button><button class="primary-button" id="completeLesson">${progress[id]?'Completed ✓':'Mark gate complete'} <span>→</span></button></div>`); $$('#modalContent [data-practice]').forEach(btn=>btn.addEventListener('click',()=>{const right=Number(btn.dataset.practice)===topic.practice.answer; $$('#modalContent [data-practice]').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); const feedback=$('#practiceFeedback'); feedback.textContent=right?topic.practice.explain:'Not quite. Revisit the section above and try again.'; feedback.className=`practice-feedback ${right?'correct':'incorrect'}`})); $('#completeLesson').addEventListener('click',()=>{progress[id]=true;store.set('progress',progress);renderTopics();closeModal();toast('Gate complete — your progress is saved.')}); $('#closeLesson').addEventListener('click',closeModal); }
  function renderAssignments() {
    assignments=store.get('assignments',defaultAssignments);
    const now=Date.now(),active=assignments.filter(a=>!a.locked&&new Date(a.due).getTime()>now);
    $('#openCount').textContent=active.filter(a=>!submissions[a.id]).length;
    $('#submittedCount').textContent=Object.keys(submissions).length;
    $('#upcomingCount').textContent=assignments.filter(a=>!a.locked&&new Date(a.due).getTime()>now&&new Date(a.due).getTime()-now<7*86400000).length;
    const renderOne=a=>{
      const submitted=!!submissions[a.id],expired=Date.now()>new Date(a.due).getTime(),locked=a.locked||expired,attachment=a.questionPdf;
      const imageAttachment=attachment&&(/image\//i.test(attachment.mimeType||'')||/\.(png|jpe?g|gif|webp)$/i.test(attachment.name||''));
      return `<article class="assignment-card"><span class="assignment-symbol">?</span><div class="assignment-card-info"><h3>${esc(a.title)}</h3><p>${esc(a.description||'Open or download the attached question.')}</p>${a.materials?.length?`<div class="assignment-materials">${a.materials.map(([name,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ${esc(name)} ?</a>`).join('')}</div>`:''}${attachment?`<div class="assignment-materials"><button class="small-button" data-attachment-view="${esc(attachment.id)}" data-file-name="${esc(attachment.name)}">View question ${imageAttachment?'image':'PDF'}</button><button class="small-button" data-attachment-download="${esc(attachment.id)}" data-file-name="${esc(attachment.name)}">Download ${imageAttachment?'image':'PDF'} ?</button></div>`:''}<div class="assignment-due">Due ${formatDate(a.due)} ${a.locked?' ? Locked':expired?' ? Closed':''}${submitted?` ? Submitted: ${esc(submissions[a.id].name)}`:''}</div></div>${submitted?`<span class="submitted-badge">Submitted ?</span>${teacherMode?`<button class="small-button" data-review="${a.id}">Review</button>`:''}`:locked?'<span class="locked-note">Submission closed</span>':`<button class="primary-button" data-submit="${a.id}">Upload work <span>?</span></button>`}${teacherMode?`<div class="teacher-actions"><button class="small-button" data-lock="${a.id}">${a.locked?'Unlock':'Lock'}</button><button class="small-button danger" data-delete="${a.id}">Delete</button></div>`:''}</article>`;
    };
    $('#assignmentList').innerHTML=assignments.length?assignments.map(renderOne).join(''):'<div class="empty-state"><b>No assignments yet</b>Your teacher has not added any tasks.</div>';
    $('#homeAssignments').innerHTML=assignments.slice(0,2).map(a=>`<div class="mini-assignment"><span class="assignment-symbol">?</span><span><b>${esc(a.title)}</b><small>Due ${formatDate(a.due)}</small></span><span class="status-chip">${submissions[a.id]?'DONE':a.locked?'LOCKED':Date.now()>new Date(a.due).getTime()?'CLOSED':'OPEN'}</span></div>`).join('')||'<p class="exam-home-copy">No assignments yet.</p>';
    $$('#assignmentList [data-submit]').forEach(btn=>btn.addEventListener('click',()=>submissionModal(btn.dataset.submit)));
    $$('#assignmentList [data-attachment-view]').forEach(btn=>btn.addEventListener('click',()=>viewPdf(btn.dataset.attachmentView,btn.dataset.fileName)));
    $$('#assignmentList [data-attachment-download]').forEach(btn=>btn.addEventListener('click',()=>downloadAttachment(btn.dataset.attachmentDownload,btn.dataset.fileName)));
    $$('#assignmentList [data-review]').forEach(btn=>btn.addEventListener('click',()=>reviewSubmission(btn.dataset.review)));
    $$('#assignmentList [data-lock]').forEach(btn=>btn.addEventListener('click',()=>{const a=assignments.find(x=>x.id===btn.dataset.lock);a.locked=!a.locked;store.set('assignments',assignments);renderAssignments();toast(a.locked?'Assignment locked.':'Assignment unlocked.')}));
    $$('#assignmentList [data-delete]').forEach(btn=>btn.addEventListener('click',()=>{assignments=assignments.filter(a=>a.id!==btn.dataset.delete);store.set('assignments',assignments);renderAssignments();toast('Assignment removed.')}));
  }
  async function reviewSubmission(id) {
    const sub=submissions[id];if(!sub)return;let preview='';
    if(sub.attachmentId){
      let file=await attachmentDB.get(sub.attachmentId);
      if(!file&&driveApiUrl)try{file=await driveFileBlob(sub.attachmentId);}catch{}
      if(file){const url=URL.createObjectURL(file),isPdf=file.type==='application/pdf'||/\.pdf$/i.test(sub.name||'');preview=isPdf?`<iframe class="pdf-preview" src="${url}" title="Submitted answer PDF"></iframe>`:`<img class="answer-image-preview" src="${url}" alt="Submitted answer attachment">`;preview+=`<div class="modal-actions"><a class="primary-button download-link" href="${url}" download="${esc(sub.name)}">Download answer attachment ↓</a></div>`;}
    }else if(sub.file){preview=`<iframe class="pdf-preview" src="${sub.file}" title="Submitted answer PDF"></iframe><div class="modal-actions"><a class="primary-button download-link" href="${sub.file}" download="${esc(sub.name)}">Download answer PDF ↓</a></div>`;}
    openModal(`<p class="eyebrow">ADMIN REVIEW</p><h2 id="modalTitle">${esc(sub.name)}</h2><p class="modal-intro">Submitted ${new Date(sub.submittedAt).toLocaleString()}${sub.fileExpired?' · PDF removed after 10 days':''}</p><div class="review-answer">${esc(sub.text||'No written response.')}</div>${preview}<div class="modal-actions"><button class="secondary-button" id="closeReview">Close</button></div>`);$('#closeReview').addEventListener('click',closeModal);
  }
  async function getAssignmentFile(id) {
    let file=await attachmentDB.get(id);
    if(!file&&driveApiUrl){const result=await driveJsonp({action:'file',id}),raw=atob(result.file.data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);file=new Blob([bytes],{type:result.file.mimeType||'application/pdf'});}
    if(!file&&cloudApiBase)file=await (await cloudFileFetch(`/api/files/${encodeURIComponent(id)}`)).blob();
    return file;
  }
  async function downloadAttachment(id,name) {
    try{const file=await getAssignmentFile(id);if(!file)return toast('This attachment is unavailable.');const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=name||'question-file';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch{toast('Could not download the question file.');}
  }
  async function viewPdf(id,name) {
    try{const file=await getAssignmentFile(id);if(!file)return toast('This attachment is unavailable.');const url=URL.createObjectURL(file),isImage=file.type.startsWith('image/')||/\.(png|jpe?g|gif|webp)$/i.test(name||'');
      openModal(`<p class="eyebrow">ASSIGNMENT QUESTION</p><h2 id="modalTitle">${esc(name)}</h2>${isImage?`<img class="question-image-preview" src="${url}" alt="${esc(name)}">`:`<iframe class="pdf-preview" src="${url}" title="${esc(name)}"></iframe>`}<div class="modal-actions"><a class="primary-button download-link" href="${url}" download="${esc(name)}">Download ${isImage?'image':'PDF'} ?</a><button class="secondary-button" id="closeQuestionPdf">Close</button></div>`);
      $('#closeQuestionPdf').addEventListener('click',closeModal);
    }catch{toast('Could not open the question attachment.');}
  }
  function submissionModal(id) {
    const item=assignments.find(a=>a.id===id);
    if(!item||item.locked||Date.now()>new Date(item.due).getTime())return toast('This submission is closed.');
    openModal(`<p class="eyebrow">ASSIGNMENT SUBMISSION</p><h2 id="modalTitle">${esc(item.title)}</h2><p class="modal-intro">${esc(item.description||'Upload your completed answer sheet below.')}<br>Due ${formatDate(item.due)}</p><form id="submissionForm"><div class="form-field"><label for="answerText">Written answer (optional)</label><textarea id="answerText" placeholder="Add a note or type your answer..."></textarea></div><div class="form-field"><label for="uploadFile">Answer sheet: photo or PDF (optional, max 5 MB)</label><input type="file" id="uploadFile" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"></div><p class="locked-note">Add a written answer, attach a photo or PDF, or include both. At least one is required. ${driveApiUrl?'Your teacher can review submissions from another browser.':'This browser is the only place the teacher can review this submission.'}</p><div class="modal-actions"><button type="button" class="secondary-button" id="cancelSubmit">Cancel</button><button class="primary-button">Submit assignment <span>&rarr;</span></button></div></form>`);
    $('#cancelSubmit').addEventListener('click',closeModal);
    $('#submissionForm').addEventListener('submit',async e=>{
      e.preventDefault();const file=$('#uploadFile').files[0],text=$('#answerText').value.trim();
      if(!text&&!file)return toast('Write an answer or choose a photo/PDF.');
      if(file&&file.size>5*1024*1024)return toast('Please choose a file no larger than 5 MB.');
      if(file&&!['application/pdf','image/png','image/jpeg'].includes(inferMimeType(file)))return toast('Answer files must be a PDF, PNG, or JPG image.');
      try{
        const attachmentId=file?`submission-${id}-${Date.now()}`:'';
        if(file){await attachmentDB.put(attachmentId,file);trackPdf(attachmentId,file);}
        submissions[id]={text,name:file?.name||'Written response',attachmentId,submittedAt:Date.now()};store.set('submissions',submissions);
        if(driveApiUrl)await drivePost({action:'submit',assignmentId:id,text,name:file?.name||'Written response',mimeType:file?inferMimeType(file):'',data:file?await blobToBase64(file):''});
        closeModal();renderAssignments();toast('Assignment submitted.');
      }catch(error){showCloudStatus(`Submission saved here; Drive upload failed: ${error.message}`,true);toast('Submission stayed in this browser. Please retry while online.');}
    });
  }
  function addAssignmentModal() {
    openModal(`<p class="eyebrow">ADMIN PORTAL</p><h2 id="modalTitle">Create assignment</h2><p class="modal-intro">Type the question, attach a photo/PDF, or use both. Students can download the attachment and upload their answer sheet.</p><form id="newAssignmentForm"><div class="form-field"><label for="assignmentTitle">Title</label><input id="assignmentTitle" name="title" placeholder="e.g. LR(1) question set" required></div><div class="form-field"><label for="assignmentDescription">Question or instructions (optional if you attach a file)</label><textarea id="assignmentDescription" name="description" placeholder="Type the question or instructions here"></textarea></div><div class="form-field"><label for="assignmentFile">Attach question image or PDF (optional, max 5 MB)</label><input id="assignmentFile" name="questionFile" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"></div><div class="form-field"><label for="assignmentDue">Due date and time</label><input id="assignmentDue" name="due" type="datetime-local" required></div><div class="modal-actions"><button type="button" class="secondary-button" id="cancelCreate">Cancel</button><button class="primary-button">Create assignment</button></div></form>`);
    $('#cancelCreate').addEventListener('click',closeModal);
    $('#newAssignmentForm').addEventListener('submit',async e=>{
      e.preventDefault();const form=new FormData(e.target),due=String(form.get('due')),file=form.get('questionFile'),description=String(form.get('description')||'').trim();
      if(new Date(due).getTime()<=Date.now())return toast('Choose a due date in the future.');
      if(!description&&!file?.size)return toast('Type a question or attach an image/PDF.');
      if(file?.size>5*1024*1024)return toast('Question attachment must be no larger than 5 MB.');
      if(file?.size&&!['application/pdf','image/png','image/jpeg'].includes(inferMimeType(file)))return toast('Question attachments must be a PDF, PNG, or JPG image.');
      try{const id=`a${Date.now()}`,attachmentId=file?.size?`question-${id}`:'';if(file?.size){await attachmentDB.put(attachmentId,file);trackPdf(attachmentId,file);}assignments.push({id,title:String(form.get('title')),description,due,locked:false,questionPdf:attachmentId?{id:attachmentId,name:file.name,mimeType:inferMimeType(file)||'application/pdf'}:null});store.set('assignments',assignments);closeModal();renderAssignments();toast('Assignment created.');}
      catch{toast('Could not save the question attachment in this browser.');}
    });
  }
  function renderExamHome() { const now=Date.now(),opens=examConfig.opensAt?new Date(examConfig.opensAt).getTime():0,closes=examConfig.closesAt?new Date(examConfig.closesAt).getTime():Infinity; const available=!examConfig.locked&&now>=opens&&now<closes; const state=examConfig.locked?'This exam is not open yet.':now<opens?'The exam will open '+formatDate(examConfig.opensAt)+'.':now>=closes?'This exam window has ended.':'Your exam is ready when you are.'; $('#homeExam').innerHTML=`<div class="exam-home-copy"><b>${esc(examConfig.title)}</b><p>${state}</p><button class="text-button" data-view="exam">${available?'Enter exam':'View exam room'} →</button></div>`; }
  function saveExamConfig() { store.set('examConfig',examConfig); renderExam(); renderExamHome(); }
  const examImageUrls=new Map();
  async function loadExamQuestionImages() {
    for(const image of $$('[data-exam-image]')){
      const id=image.dataset.examImage;if(examImageUrls.has(id)){image.src=examImageUrls.get(id);continue;}
      try{
        let file=await attachmentDB.get(id);
        if(!file&&driveApiUrl)file=await driveFileBlob(id);
        if(!file&&cloudApiBase)file=await (await cloudFileFetch(`/api/files/${encodeURIComponent(id)}`)).blob();
        if(!file)continue;
        const url=URL.createObjectURL(file);examImageUrls.set(id,url);image.src=url;
      }catch{image.alt='Question image could not be loaded';}
    }
  }
  function teacherExamPanel() {
    const questions=examConfig.questions||[];
    return `<section class="panel teacher-panel exam-admin-panel">
      <div class="exam-admin-heading"><div><p class="eyebrow">ADMIN PORTAL</p><h2>Set up the exam</h2><p>Set when it opens, then add and check the questions.</p></div><span class="question-count">${questions.length} question${questions.length===1?'':'s'}</span></div>
      <section class="exam-admin-section"><div class="exam-step"><span>1</span><div><h3>Schedule</h3><p>All times use your device’s local time.</p></div></div>
        <form id="examConfigForm" class="exam-config-grid">
          <div class="form-field exam-title-field"><label for="examTitle">Exam name</label><input id="examTitle" name="title" value="${esc(examConfig.title)}" required></div>
          <div class="form-field"><label for="examDuration">Time limit</label><div class="input-with-suffix"><input id="examDuration" name="duration" type="number" min="1" max="240" value="${Number(examConfig.duration)}" required><span>minutes</span></div></div>
          <div class="form-field"><label for="examOpens">Open date and time</label><input id="examOpens" name="opensAt" type="datetime-local" value="${esc(examConfig.opensAt)}"></div>
          <div class="form-field"><label for="examCloses">Close date and time</label><input id="examCloses" name="closesAt" type="datetime-local" value="${esc(examConfig.closesAt)}"></div>
          <div class="exam-config-actions"><button class="primary-button">Save schedule</button><button type="button" class="secondary-button" id="examLockButton">${examConfig.locked?'Unlock for learners':'Lock exam'}</button><span>${examConfig.locked?'Learners cannot start until you unlock it.':`Exam is unlocked${examConfig.opensAt?` · opens ${formatDate(examConfig.opensAt)}`:''}.`}</span></div>
        </form>
      </section>
      <section class="exam-admin-section"><div class="exam-step"><span>2</span><div><h3>Add questions</h3><p>Choose multiple choice or numerical answer. Multiple-choice questions have four choices by default.</p></div></div>
        <form id="newQuestionForm" class="question-admin-form">
          <div class="form-field question-prompt-field"><label for="newQuestionText">Question</label><textarea id="newQuestionText" name="q" placeholder="Write the question here" required></textarea></div>
          <div class="form-field question-image-field"><label for="newQuestionImage">Question image (optional, PNG/JPG up to 5 MB)</label><input id="newQuestionImage" name="image" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg"></div>
          <div class="form-field"><label for="questionType">Answer type</label><select id="questionType" name="type"><option value="choice">Multiple choice (A?D)</option><option value="numeric">Numerical answer</option></select></div>
          <div class="form-field choice-field"><label for="choiceA">Choice A</label><input id="choiceA" name="a" placeholder="Choice A" value="A" required></div>
          <div class="form-field choice-field"><label for="choiceB">Choice B</label><input id="choiceB" name="b" placeholder="Choice B" value="B" required></div>
          <div class="form-field choice-field"><label for="choiceC">Choice C</label><input id="choiceC" name="c" placeholder="Choice C" value="C" required></div>
          <div class="form-field choice-field"><label for="choiceD">Choice D</label><input id="choiceD" name="d" placeholder="Choice D" value="D" required></div>
          <div class="form-field choice-field"><label for="correctChoice">Correct choice</label><select id="correctChoice" name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></div>
          <div class="form-field numeric-field" hidden><label for="numericAnswer">Correct numerical answer</label><input id="numericAnswer" name="numericAnswer" type="number" step="any" placeholder="e.g. 3.14" disabled></div>
          <div class="form-field numeric-field" hidden><label for="answerTolerance">Accepted tolerance (optional)</label><input id="answerTolerance" name="tolerance" type="number" min="0" step="any" value="0" disabled></div>
          <button class="small-button add-question-button">Add question</button>
        </form>
        <details class="exam-import-details"><summary>Import questions from a PDF (optional)</summary><p>Text PDFs are read directly. Scanned pages are read with OCR automatically. OCR can misread symbols or answer choices, so review every question and correct answer before adding them.</p><form id="pdfQuestionImportForm" class="question-admin-form"><div class="form-field"><label for="examQuestionPdf">Question paper PDF (up to 5 MB)</label><input id="examQuestionPdf" name="paper" type="file" accept="application/pdf,.pdf" required></div><button class="small-button">Read questions from PDF</button></form><div id="pdfQuestionPreview"></div></details>
      </section>
      <section class="exam-admin-section"><div class="exam-step"><span>3</span><div><h3>Review question bank</h3><p>Remove any question you do not want on this exam.</p></div></div><div class="question-admin-list">${questions.length?questions.map((q,i)=>`<div><span><b>${i+1}.</b> ${esc(q.q)} <small>${q.type==='numeric'?'Numerical answer':'Multiple choice'}</small>${q.image?.id?`<img class="exam-question-image" data-exam-image="${esc(q.image.id)}" alt="Question image: ${esc(q.image.name||q.q)}">`:''}</span><button class="small-button danger" data-remove-question="${esc(q.id)}" type="button">Remove</button></div>`).join(''):'<p class="question-bank-empty">No questions added yet. Add one above or import a text PDF.</p>'}</div></section>
    </section>`;
  }
  function renderImportedQuestions() { $('#pdfQuestionPreview').innerHTML=importedQuestions.length?`<div class="import-preview-head"><b>${importedQuestions.length} questions detected</b><button class="small-button" id="importDetectedQuestions" type="button">Add reviewed questions to exam</button></div>${importedQuestions.map((q,i)=>`<article class="import-question"><b>Question ${i+1}</b><textarea data-import-q="${i}" aria-label="Question ${i+1}">${esc(q.q)}</textarea>${q.options.map((option,j)=>`<input data-import-option="${i}" data-option-index="${j}" value="${esc(option)}" aria-label="Question ${i+1}, option ${String.fromCharCode(65+j)}">`).join('')}<select data-import-answer="${i}" aria-label="Correct answer for question ${i+1}"><option value="">Choose correct answer</option>${q.options.map((_,j)=>`<option value="${j}">${String.fromCharCode(65+j)}</option>`).join('')}</select></article>`).join('')}`:''; $('#importDetectedQuestions')?.addEventListener('click',()=>{const drafted=importedQuestions.map((q,i)=>{const answer=$(`[data-import-answer="${i}"]`).value;return {id:`pdfq${Date.now()}${i}`,q:$(`[data-import-q="${i}"]`).value.trim(),options:q.options.map((_,j)=>$(`[data-import-option="${i}"][data-option-index="${j}"]`).value.trim()),answer:answer===''?-1:Number(answer)};});if(drafted.some(q=>!q.q||q.options.length<2||q.options.some(option=>!option)||q.answer<0))return toast('Review every question and choose its correct answer.');examConfig.questions.push(...drafted);importedQuestions=[];saveExamConfig();toast('Questions added to the exam.');}); }
  function parseMcqLines(lines) { const questions=[];let current=null;const appendOptions=text=>{const markers=[...text.matchAll(/(?:^|\s)(?:\(?[A-E]\)?[.)])\s*/gi)];if(!markers.length)return false;for(let i=0;i<markers.length;i++){const begin=markers[i].index+markers[i][0].length,end=i+1<markers.length?markers[i+1].index:text.length,value=text.slice(begin,end).trim();if(value)current.options.push(value);}return true;};for(const raw of lines){const line=raw.trim();if(!line)continue;if(current&&/^(?:\(?[A-E]\)?[.)])\s*/i.test(line)){appendOptions(line);continue;}const question=line.match(/^(?:Q(?:uestion)?\s*)?(\d{1,3})[.):]\s*(.+)$/i);if(question){current={q:question[2].trim(),options:[]};questions.push(current);const split=current.q.split(/\s+(?=(?:\(?A\)?[.)])\s)/i);current.q=split.shift().trim();if(split.length)appendOptions(split.join(' '));continue;}if(current&&current.options.length)current.options[current.options.length-1]+=` ${line}`;else if(current)current.q+=` ${line}`;}return questions.filter(q=>q.q&&q.options.length>=2).map(q=>({...q,options:q.options.slice(0,5)})); }
  async function loadTesseract() {
    if(window.Tesseract)return window.Tesseract;
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('OCR library could not load'));document.head.append(script);});
    if(!window.Tesseract)throw new Error('OCR library is unavailable');
    return window.Tesseract;
  }
  async function extractQuestionsFromPdf(file) {
    if(!window.pdfjsLib)return toast('PDF reader could not load. Check the internet connection and reload.');
    if(!file||file.size>5*1024*1024)return toast('Choose a PDF no larger than 5 MB.');
    let worker;
    try{
      window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
      const lines=[];
      for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
        const page=await pdf.getPage(pageNo),content=await page.getTextContent(),rows=new Map();
        for(const item of content.items){if(!item.str?.trim())continue;const y=Math.round(item.transform[5]);if(!rows.has(y))rows.set(y,[]);rows.get(y).push({x:item.transform[4],text:item.str});}
        for(const [,items] of [...rows].sort((a,b)=>b[0]-a[0]))lines.push(items.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' '));
      }
      importedQuestions=parseMcqLines(lines);
      if(!importedQuestions.length){
        $('#pdfQuestionPreview').innerHTML='<div class="import-message"><b>Reading the scanned pages…</b><span id="ocrProgressText">Loading OCR. Keep this page open; scanned papers can take a little while.</span></div>';
        const tesseract=await loadTesseract();
        worker=await tesseract.createWorker('eng',1,{logger:message=>{if(message.status==='recognizing text'){const progress=$('#ocrProgressText');if(progress)progress.textContent=`Recognizing text · ${Math.round((message.progress||0)*100)}%`;}}});
        const recognizedLines=[];
        for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
          const progress=$('#ocrProgressText');if(progress)progress.textContent=`Reading page ${pageNo} of ${pdf.numPages}…`;
          const page=await pdf.getPage(pageNo),viewport=page.getViewport({scale:2}),canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          const result=await worker.recognize(canvas);recognizedLines.push(...result.data.text.split(/\r?\n/));
          canvas.width=1;canvas.height=1;
        }
        importedQuestions=parseMcqLines(recognizedLines);
      }
      await worker?.terminate();worker=null;
      renderImportedQuestions();
      if(!importedQuestions.length){$('#pdfQuestionPreview').innerHTML='<div class="import-message"><b>OCR could not identify the question layout.</b><span>You can still add the questions manually above. Check the extracted text and choices before using them in an exam.</span></div>';toast('Text was read, but the question format needs manual entry.');}
      else toast(`${importedQuestions.length} questions recognized. Review every question and correct answer before adding them.`);
    }catch(error){await worker?.terminate();$('#pdfQuestionPreview').innerHTML=`<div class="import-message"><b>Could not recognize this PDF.</b><span>${esc(error.message||'Check the file and internet connection, then try again.')}</span></div>`;toast('PDF recognition failed. You can add questions manually.');}
  }
  function isExamAnswerCorrect(question,response) { if(question.type==='numeric'){if(response===undefined||response===null||response==='')return false;const value=Number(response),answer=Number(question.answer),tolerance=Math.max(0,Number(question.tolerance)||0);return Number.isFinite(value)&&Number.isFinite(answer)&&Math.abs(value-answer)<=tolerance;}return Number(response)===Number(question.answer); }
  function startExam() { const now=Date.now(),close=examConfig.closesAt?new Date(examConfig.closesAt).getTime():Infinity; if(examConfig.locked||now<(examConfig.opensAt?new Date(examConfig.opensAt).getTime():0)||now>=close)return toast('The exam is outside its open window.'); attempt={startedAt:now,endsAt:Math.min(now+Number(examConfig.duration)*60000,close),answers:{},submitted:false};store.set('attempt',attempt);renderExam(); }
  let examTick=null;
  function renderExam() { clearInterval(examTick); if(!$('#examMain'))return; const now=Date.now(),opens=examConfig.opensAt?new Date(examConfig.opensAt).getTime():0,closes=examConfig.closesAt?new Date(examConfig.closesAt).getTime():Infinity,available=!examConfig.locked&&now>=opens&&now<closes; if(attempt&&!attempt.submitted&&attempt.endsAt<=now){attempt.submitted=true;attempt.submittedAt=now;store.set('attempt',attempt);} let content=''; if(teacherMode)content+=teacherExamPanel(); if(attempt&&attempt.submitted){const correct=examConfig.questions.filter(q=>isExamAnswerCorrect(q,attempt.answers[q.id])).length;content+=`<section class="panel"><div class="exam-welcome"><span class="exam-emblem">✓</span><h2>Exam submitted</h2><p>Your saved answers are ready for review.</p><div class="exam-facts"><span>Questions<br><b>${examConfig.questions.length}</b></span><span>Answered<br><b>${Object.keys(attempt.answers||{}).length} / ${examConfig.questions.length}</b></span><span>Score<br><b>${correct} / ${examConfig.questions.length}</b></span></div></div></section>`; } else if(attempt&&attempt.endsAt>now){ content+=`<section class="panel"><div class="exam-topline"><span>${esc(examConfig.title)} · ${examConfig.questions.length} questions</span><span class="timer" id="examTimer">--:--</span></div><div id="questionArea">${examConfig.questions.map((q,i)=>`<article class="question"><small>QUESTION ${String(i+1).padStart(2,'0')}</small><h3>${esc(q.q)}</h3>${q.image?.id?`<img class="exam-question-image" data-exam-image="${esc(q.image.id)}" alt="Question image: ${esc(q.image.name||q.q)}">`:``}${q.type==='numeric'?`<div class="form-field numeric-response"><label for="answer-${esc(q.id)}">Your numerical answer</label><input id="answer-${esc(q.id)}" type="number" step="any" data-numeric-q="${esc(q.id)}" value="${attempt.answers[q.id]??''}" autocomplete="off"></div>`:`<div class="option-list">${(q.options||[]).map((op,j)=>`<button class="option ${attempt.answers[q.id]===j?'selected':''}" data-q="${esc(q.id)}" data-answer="${j}">${String.fromCharCode(65+j)}. &nbsp;${esc(op)}</button>`).join('')}</div>`}</article>`).join('')}</div><div class="exam-submit-row"><span class="saved-note">✓ Answers save automatically</span><button class="primary-button" id="submitExam">Submit exam <span>→</span></button></div></section>`; } else { const detail=examConfig.locked?'Your teacher will unlock the exam when it is time.':now<opens?`Opens ${formatDate(examConfig.opensAt)}.`:now>=closes?'The exam window has closed.':'Take your time. Your answers are saved automatically and submitted when time runs out.'; content+=`<section class="panel"><div class="exam-welcome"><span class="exam-emblem">◷</span><h2>${esc(examConfig.title)}</h2><p>${detail}</p><div class="exam-facts"><span>Questions<br><b>${examConfig.questions.length}</b></span><span>Time limit<br><b>${examConfig.duration} minutes</b></span><span>Topics<br><b>Parsing methods</b></span></div>${available?`<button class="primary-button" id="startExam">Start exam <span>→</span></button>`:`<span class="locked-note">${examConfig.locked?'Exam locked':now>=closes?'Exam closed':'Scheduled exam'}</span>`}</div></section>`; }
    $('#examMain').innerHTML=content; loadExamQuestionImages(); $('#examMain').querySelector('#examConfigForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);examConfig.title=String(f.get('title'));examConfig.duration=Math.min(240,Math.max(1,Number(f.get('duration'))));examConfig.opensAt=String(f.get('opensAt'));examConfig.closesAt=String(f.get('closesAt'));saveExamConfig();toast('Exam schedule saved.')}); $('#examLockButton')?.addEventListener('click',()=>{examConfig.locked=!examConfig.locked;saveExamConfig();toast(examConfig.locked?'Exam locked.':'Exam unlocked.')}); $('#pdfQuestionImportForm')?.addEventListener('submit',e=>{e.preventDefault();extractQuestionsFromPdf(e.target.elements.paper.files[0]);}); $('#questionType')?.addEventListener('change',e=>{const numeric=e.target.value==='numeric';$$('#newQuestionForm .choice-field').forEach(field=>{field.hidden=numeric;field.querySelectorAll('input,select').forEach(input=>{input.disabled=numeric;input.required=!numeric;});});$$('#newQuestionForm .numeric-field').forEach(field=>{field.hidden=!numeric;field.querySelectorAll('input').forEach(input=>{input.disabled=!numeric;input.required=numeric&&input.id==='numericAnswer';});});}); $('#newQuestionForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),q=String(f.get('q')).trim(),image=f.get('image');if(image?.size>5*1024*1024)return toast('Question image must be no larger than 5 MB.');if(image?.size&&!['image/png','image/jpeg'].includes(inferMimeType(image)))return toast('Question images must be PNG or JPG.');let imageRef=null;if(image?.size){imageRef={id:`exam-image-${Date.now()}`,name:image.name,mimeType:inferMimeType(image)};try{await attachmentDB.put(imageRef.id,image);}catch{return toast('Could not save the question image in this browser.');}}if(f.get('type')==='numeric'){const answer=Number(f.get('numericAnswer')),tolerance=Number(f.get('tolerance')||0);if(!Number.isFinite(answer)||!Number.isFinite(tolerance)||tolerance<0)return toast('Enter a valid numeric answer and non-negative tolerance.');examConfig.questions.push({id:`q${Date.now()}`,q,type:'numeric',answer,tolerance,image:imageRef});}else{examConfig.questions.push({id:`q${Date.now()}`,q,type:'choice',options:['a','b','c','d'].map(key=>String(f.get(key)).trim()),answer:Number(f.get('answer')),image:imageRef});}saveExamConfig();toast('Question added to the exam.')}); $$('[data-remove-question]').forEach(button=>button.addEventListener('click',()=>{examConfig.questions=examConfig.questions.filter(q=>q.id!==button.dataset.removeQuestion);saveExamConfig();toast('Question removed.')})); $('#startExam')?.addEventListener('click',startExam); $$('#questionArea [data-q]').forEach(btn=>btn.addEventListener('click',()=>{attempt.answers[btn.dataset.q]=Number(btn.dataset.answer);store.set('attempt',attempt);const siblings=$$(`[data-q="${CSS.escape(btn.dataset.q)}"]`);siblings.forEach(b=>b.classList.toggle('selected',b===btn));})); $$('[data-numeric-q]').forEach(input=>input.addEventListener('input',()=>{const value=input.value; if(value==='')delete attempt.answers[input.dataset.numericQ];else attempt.answers[input.dataset.numericQ]=Number(value);store.set('attempt',attempt);})); $('#submitExam')?.addEventListener('click',()=>finishExam(false)); if(attempt&&!attempt.submitted&&attempt.endsAt>now){updateTimer();examTick=setInterval(updateTimer,1000);} renderExamHome(); }
  function updateTimer(){if(!attempt||attempt.submitted)return;const remaining=Math.max(0,attempt.endsAt-Date.now());const node=$('#examTimer');if(node){const s=Math.ceil(remaining/1000);node.textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}if(remaining<=0)finishExam(true);}
  function finishExam(auto){if(!attempt)return;attempt.submitted=true;attempt.submittedAt=Date.now();store.set('attempt',attempt);renderExam();toast(auto?'Time is up. Your exam has been submitted.':'Exam submitted. Your answers are saved.');}
  function calculator(){openModal(`<p class="eyebrow">QUICK TOOL</p><h2 id="modalTitle">Online calculator</h2><input class="calc-display" id="calcDisplay" value="0" aria-label="Calculator display" readonly><div class="calc-grid">${['C','±','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','⌫','0','.','='].map((k,i)=>`<button class="calc-key ${[3,7,11,15].includes(i)?'operator':''} ${k==='='?'equals':''}" data-key="${k}">${k}</button>`).join('')}</div>`);let expr='',fresh=true;$$('.calc-key').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.dataset.key,display=$('#calcDisplay');if(key==='C'){expr='';display.value='0';fresh=true;return}if(key==='⌫'){expr=expr.slice(0,-1);display.value=expr||'0';return}if(key==='='){try{const safe=expr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');if(!/^[\d.+\-*/()%\s]+$/.test(safe))throw 0;const result=Function(`"use strict"; return (${safe})`)();if(!Number.isFinite(result))throw 0;display.value=String(Number(result.toFixed(9)));expr=display.value;fresh=true}catch{display.value='Error';expr='';fresh=true}return}if(key==='±'){if(!expr)return;expr=expr.startsWith('-')?expr.slice(1):`-${expr}`;display.value=expr;return}if(fresh&&/^[0-9.]$/.test(key))expr='';expr+=key;display.value=expr;fresh=false;}));}
  function updateClock(){const now=new Date(),hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hourCycle:'h23',timeZone:'Asia/Kolkata'}).format(now));const greeting=hour<12?'Good morning, Soumi':hour<17?'Good afternoon, Soumi':'Good evening, Soumi';const greetingNode=$('#greetingText'),dateNode=$('#greetingDate');if(greetingNode)greetingNode.textContent=greeting;if(dateNode)dateNode.textContent=now.toLocaleDateString('en-IN',{weekday:'long',month:'long',day:'numeric',timeZone:'Asia/Kolkata'}).toUpperCase();const time=$('#todayLabel');if(time)time.textContent=`${now.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})} IST`;}
  function renderSlideGrid(){
    $('#slideGrid').innerHTML=imageLessons.map(slide=>`<button class="slide-card ${activeSlide===slide.n?'active':''}" data-slide="${slide.n}" aria-pressed="${activeSlide===slide.n}"><span class="slide-card-meta"><b>${String(slide.n).padStart(2,'0')}</b><small>${esc(slide.title)}</small></span><span class="slide-card-arrow" aria-hidden="true">\u2197</span></button>`).join('');
    $$('[data-slide]').forEach(button=>button.addEventListener('click',()=>{clearTimeout(animationTimer);activeSlide=Number(button.dataset.slide);slideStep=0;slideChoice=null;animationPlaying=true;renderSlideGrid();renderSlide();$('#slidePlayer').scrollIntoView({behavior:'smooth',block:'start'})}));
    $('#slideProgress').textContent=activeSlide?`Slide ${activeSlide} of ${imageLessons.length}`:`${imageLessons.length} slides`;
  }
  function createLR0Graph(slide){
    const productions=slide.display.map(line=>{const match=line.match(/^([A-Z]) → (.*)$/u);if(!match)return null;const rhs=match[2].trim();if(rhs&&!/^[A-Za-z()]*$/.test(rhs)&&rhs!=='ε')return null;if(match[1]==='X'||match[1]==='Y')return null;return {lhs:match[1],rhs:[...rhs].filter(symbol=>symbol!=='ε')}}).filter(Boolean);
    if(!productions.length)return null;
    const start=productions[0].lhs;const all=[{lhs:`${start}′`,rhs:[start]},...productions];const nonterminals=new Set(all.map(rule=>rule.lhs));const byLhs=new Map();all.forEach((rule,index)=>{if(!byLhs.has(rule.lhs))byLhs.set(rule.lhs,[]);byLhs.get(rule.lhs).push(index)});
    const key=items=>items.map(([p,d])=>`${p}.${d}`).sort().join('|');
    const closure=source=>{const result=new Map(source.map(item=>[`${item[0]}.${item[1]}`,item]));let changed=true;while(changed){changed=false;for(const [p,d] of [...result.values()]){const next=all[p].rhs[d];if(nonterminals.has(next))for(const q of byLhs.get(next)||[]){const k=`${q}.0`;if(!result.has(k)){result.set(k,[q,0]);changed=true}}}}return [...result.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1])};
    const states=[closure([[0,0]])],edges=[],seen=new Map([[key(states[0]),0]]),depth=[0];
    for(let from=0;from<states.length;from++){const symbols=[];for(const [p,d] of states[from]){const symbol=all[p].rhs[d];if(symbol&&!symbols.includes(symbol))symbols.push(symbol)}for(const symbol of symbols){const moved=states[from].filter(([p,d])=>all[p].rhs[d]===symbol).map(([p,d])=>[p,d+1]);const next=closure(moved),k=key(next);let to=seen.get(k);if(to===undefined){to=states.length;seen.set(k,to);states.push(next);depth[to]=depth[from]+1}const existing=edges.find(edge=>edge.from===from&&edge.to===to);if(existing)existing.labels.push(symbol);else edges.push({from,to,labels:[symbol]})}}
    const ntsForSize=nonterminals;
    const hasConflict=items=>{const shift=items.some(([p,d])=>d<all[p].rhs.length&&!ntsForSize.has(all[p].rhs[d]));const reductions=items.filter(([p,d])=>d===all[p].rhs.length&&p!==0);return shift&&reductions.length>0||reductions.length>1};
    const nodeHeights=states.map(items=>Math.max(74,28+items.length*21+(hasConflict(items)?24:0)));
    const layers=new Map();depth.forEach((d,index)=>{if(!layers.has(d))layers.set(d,[]);layers.get(d).push(index)});const layerGap=360,left=30,top=90,nodeWidth=245;const positions=states.map((items,index)=>{const layer=layers.get(depth[index]);const row=layer.indexOf(index);const y=top+layer.slice(0,row).reduce((sum,state)=>sum+nodeHeights[state]+36,0);return {x:left+depth[index]*layerGap,y}});const baseHeight=Math.max(250,...positions.map((pos,index)=>pos.y+nodeHeights[index]+36));const backEdges=edges.filter(edge=>edge.from!==edge.to&&depth[edge.to]<=depth[edge.from]).length;const sideEdges=edges.filter(edge=>edge.from!==edge.to&&depth[edge.to]===depth[edge.from]).length;const width=Math.max(650,left+Math.max(...depth)*layerGap+nodeWidth+sideEdges*15+45),height=baseHeight+backEdges*22+70;
    const format=([p,d])=>{const rule=all[p],rhs=rule.rhs;const text=[...rhs];text.splice(d,0,'·');return `${rule.lhs} → ${text.join('')||'·'}`};
    return {all,states,edges,positions,width,height,format,depth,baseHeight,nodeHeights};
  }
  function renderLRGraph(graph,slide,stepCount){
    const visibleEdges=Math.ceil(stepCount/slide.steps.length*graph.edges.length);const shown=new Set([0]);graph.edges.slice(0,visibleEdges).forEach(edge=>{shown.add(edge.from);shown.add(edge.to)});const active=visibleEdges?graph.edges[visibleEdges-1].to:0;const nodeWidth=245,nodeHeight=index=>graph.nodeHeights[index];const nts=new Set(graph.all.map(rule=>rule.lhs));let returnLane=0,sideLane=0;
    const paths=graph.edges.map((edge,index)=>{const a=graph.positions[edge.from],b=graph.positions[edge.to],sy=a.y+nodeHeight(edge.from)/2,ty=b.y+nodeHeight(edge.to)/2;let d,labelX,labelY;if(edge.from===edge.to){const x1=a.x+92,x2=a.x+153,top=a.y-38;d=`M ${x1} ${a.y} C ${x1-28} ${top}, ${x2+28} ${top}, ${x2} ${a.y}`;labelX=a.x+122;labelY=top-7}else if(graph.depth[edge.to]>graph.depth[edge.from]){d=`M ${a.x+nodeWidth} ${sy} C ${a.x+nodeWidth+38} ${sy}, ${b.x-38} ${ty}, ${b.x} ${ty}`;labelX=(a.x+nodeWidth+b.x)/2;labelY=(sy+ty)/2-9}else if(graph.depth[edge.to]===graph.depth[edge.from]){const rail=a.x+nodeWidth+28+(sideLane++)*15;d=`M ${a.x+nodeWidth} ${sy} C ${rail} ${sy}, ${rail} ${ty}, ${b.x+nodeWidth} ${ty}`;labelX=rail;labelY=(sy+ty)/2-8}else{const rail=graph.baseHeight+28+(returnLane++)*20,sourceX=a.x+nodeWidth/2,targetX=b.x+nodeWidth/2,sourceY=a.y+nodeHeight(edge.from),targetY=b.y+nodeHeight(edge.to);d=`M ${sourceX} ${sourceY} C ${sourceX} ${rail}, ${targetX} ${rail}, ${targetX} ${targetY}`;labelX=(sourceX+targetX)/2;labelY=rail-8}return `<g class="dfa-edge ${index<visibleEdges?'revealed':''}"><path d="${d}"/><text x="${labelX}" y="${labelY}">${esc(edge.labels.join(', '))}</text></g>`}).join('');
    const nodes=graph.states.map((items,index)=>{const hasShift=items.some(([n,d])=>d<graph.all[n].rhs.length&&!nts.has(graph.all[n].rhs[d]));const reductions=items.filter(([n,d])=>d===graph.all[n].rhs.length&&n!==0);const conflict=(hasShift&&reductions.length>0)||reductions.length>1;const kind=([n,d])=>d<graph.all[n].rhs.length?(nts.has(graph.all[n].rhs[d])?'goto':'shift'):n===0?'accept':'reduce';return `<article class="dfa-state ${shown.has(index)?'revealed':''} ${active===index&&shown.has(index)?'active':''} ${conflict?'conflict':''}" style="left:${graph.positions[index].x}px;top:${graph.positions[index].y}px;min-height:${nodeHeight(index)}px"><b class="dfa-state-name">I${index}</b>${items.map(item=>`<div class="dfa-item ${kind(item)}">${esc(graph.format(item))}</div>`).join('')}${conflict?'<small class="dfa-conflict-label">LR(0) conflict</small>':''}</article>`}).join('');
    return `<section class="motion-board dfa-board" aria-label="LR(0) automaton being built"><div class="motion-board-head"><div><span class="eyebrow">LIVE LR(0) AUTOMATON</span><b>${esc(slide.title)}</b></div><span class="motion-stage-count">${shown.size} / ${graph.states.length} states</span></div><div class="motion-progress"><i style="width:${Math.round(stepCount/slide.steps.length*100)}%"></i></div><div class="dfa-scroll" id="dfaScroll" data-width="${graph.width}" data-height="${graph.height}"><div class="dfa-canvas" style="width:${graph.width}px;height:${graph.height}px"><svg viewBox="0 0 ${graph.width} ${graph.height}" role="img" aria-label="State transitions, showing ${shown.size} of ${graph.states.length} states"><defs><marker id="dfaArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#f08bbb"/></marker></defs>${paths}</svg>${nodes}</div></div><p class="motion-caption">${stepCount===slide.steps.length?'All reachable item sets and GOTO transitions are shown.':`Building the item-set graph: ${shown.size} states and ${visibleEdges} transitions revealed.`}</p><div class="graph-controls"><button class="secondary-button" id="graphRestart">Replay</button><button class="primary-button" id="graphPlay">${animationPlaying?'Pause animation':'Play animation'}</button><button class="secondary-button" id="graphStep">Next step</button></div></section>`;
  }
  function renderConceptGraph(slide,stepCount){const shown=slide.steps.slice(0,stepCount);return `<section class="motion-board" aria-label="Concept map being revealed"><div class="motion-board-head"><div><span class="eyebrow">LIVE CONCEPT MAP</span><b>${esc(slide.title)}</b></div><span class="motion-stage-count">${stepCount} / ${slide.steps.length} nodes</span></div><div class="motion-progress"><i style="width:${Math.round(stepCount/slide.steps.length*100)}%"></i></div><div class="concept-track" id="conceptScroll">${shown.map(([title,description],index)=>`${index?'<span class="concept-arrow" aria-hidden="true">→</span>':''}<article class="concept-node ${index===shown.length-1?'current':''}"><span>${index?'STEP '+(index+1):'START'}</span><b>${esc(title)}</b><p>${esc(description)}</p></article>`).join('')}</div><p class="motion-caption">${stepCount===slide.steps.length?'Concept map complete.':stepCount?`Added ${stepCount} connected idea${stepCount===1?'':'s'}.`:'Choose Next step to reveal the concept map.'}</p></section>`}  function renderSlide(){
    clearTimeout(animationTimer);
    const slide=imageLessons.find(item=>item.n===activeSlide);if(!slide)return;
    const answered=slideChoice!==null;const stepCount=Math.max(0,Math.min(slideStep,slide.steps.length));const correct=slideChoice===slide.answer;
    const graph=createLR0Graph(slide);const motion=graph?renderLRGraph(graph,slide,stepCount):renderConceptGraph(slide,stepCount);
    $('#slidePlayer').innerHTML=`<div class="slide-player-head"><div><span class="eyebrow">QUESTION ${String(slide.n).padStart(2,'0')} OF ${imageLessons.length}</span><h2>${esc(slide.title)}</h2></div><button class="slide-reset" id="slideReset">Start over</button></div><div class="slide-content"><div class="slide-lesson"><div class="slide-board">${slide.display.map(line=>`<code>${esc(line)}</code>`).join('')}</div><section class="slide-question"><span class="eyebrow">OPTIONAL QUICK CHECK</span><h3>${esc(slide.prompt)}</h3><div class="slide-options">${slide.options.map((option,index)=>`<button class="slide-option ${answered?(index===slide.answer?'correct':index===slideChoice?'incorrect':''):''}" data-answer="${index}" ${answered?'disabled':''}>${esc(option)}</button>`).join('')}</div>${answered?`<p class="slide-result ${correct?'right':'needs-review'}"><b>${correct?'Correct':'Review the answer'}</b> ${esc(slide.summary)}</p>`:'<p class="slide-hint">The graph is animating automatically. This question is optional.</p>'}</section></div></div>${motion}${answered?`<div class="reveal-header"><span class="eyebrow">REASONING</span><b>${Math.min(stepCount+1,slide.steps.length)} / ${slide.steps.length}</b></div><div class="reveal-track">${slide.steps.map((_,index)=>`<i class="${index<stepCount?'done':''}"></i>`).join('')}</div><div class="slide-steps">${slide.steps.slice(0,stepCount).map(([title,description],index)=>`<article class="slide-step" style="--step-index:${index}"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(title)}</b><p>${esc(description)}</p></div></article>`).join('')}</div><div class="slide-controls"><button class="secondary-button" id="slideBack" ${slideStep<=0?'disabled':''}>← Previous</button><button class="primary-button" id="slideNext" ${slideStep>=slide.steps.length?'disabled':''}>${slideStep>=slide.steps.length?'All steps revealed':'Next step →'}</button></div>`:''}`;
    $('#slideReset').addEventListener('click',()=>{clearTimeout(animationTimer);slideStep=0;slideChoice=null;animationPlaying=true;renderSlide()});
    $$('[data-answer]').forEach(button=>button.addEventListener('click',()=>{slideChoice=Number(button.dataset.answer);renderSlide()}));
    const motionTrack=$('#dfaScroll');if(motionTrack){if(graphObserver)graphObserver.disconnect();const fit=()=>{const canvas=$('.dfa-canvas',motionTrack),scale=Math.min(1,(motionTrack.clientWidth-8)/Number(motionTrack.dataset.width));canvas.style.transform=`scale(${scale})`;motionTrack.style.height=`${Number(motionTrack.dataset.height)*scale}px`};if('ResizeObserver'in window){graphObserver=new ResizeObserver(fit);graphObserver.observe(motionTrack)}fit()}
    $('#graphRestart')?.addEventListener('click',()=>{clearTimeout(animationTimer);slideStep=0;animationPlaying=true;renderSlide()});
    $('#graphPlay')?.addEventListener('click',()=>{animationPlaying=!animationPlaying;if(!animationPlaying)clearTimeout(animationTimer);renderSlide()});
    $('#graphStep')?.addEventListener('click',()=>{clearTimeout(animationTimer);slideStep=Math.min(slide.steps.length,slideStep+1);if(slideStep>=slide.steps.length)animationPlaying=false;renderSlide()});
    $('#slideNext')?.addEventListener('click',()=>{slideStep=Math.min(slide.steps.length,slideStep+1);if(slideStep>=slide.steps.length)animationPlaying=false;renderSlide()});
    $('#slideBack')?.addEventListener('click',()=>{slideStep=Math.max(0,slideStep-1);animationPlaying=true;renderSlide()});
    if(animationPlaying&&slideStep<slide.steps.length)animationTimer=setTimeout(()=>{slideStep=Math.min(slide.steps.length,slideStep+1);if(slideStep>=slide.steps.length)animationPlaying=false;renderSlide()},1250);
  }
  document.addEventListener('submit',e=>{if(e.target.id!=='examConfigForm')return;const form=new FormData(e.target),opens=String(form.get('opensAt')),closes=String(form.get('closesAt'));if(opens&&closes&&new Date(closes)<=new Date(opens)){e.preventDefault();e.stopImmediatePropagation();toast('The close time must be after the open time.');}},true);
  document.addEventListener('click',e=>{const view=e.target.closest('[data-view]');if(view){e.preventDefault();navigate(view.dataset.view);return}const topic=e.target.closest('[data-topic]');if(topic){showTopic(topic.dataset.topic);return}if(e.target.closest('[data-action="calculator"]'))calculator();});
  $$('.nav-item[data-view]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.view))); $('#teacherToggle').addEventListener('click',()=>{if(teacherMode)setTeacher(false);else adminLogin()}); $('#modalClose').addEventListener('click',closeModal); $('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()}); document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()}); $('#addAssignment').addEventListener('click',addAssignmentModal);
  cleanupExpiredPdfs(); setInterval(cleanupExpiredPdfs,60*60*1000); updateClock(); setInterval(updateClock,60000); if(!driveApiUrl&&!cloudApiBase)showCloudStatus('Local-only storage'); setTeacher(teacherMode); renderTopics(); renderAssignments(); renderExam(); renderExamHome(); renderSlideGrid();
})();
