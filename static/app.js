// ─── Constants (fallbacks only — real data comes from API) ───────────────────
const FALLBACK_CAT_COLORS = {
  contact:'#16A34A', class:'#CA8A04', social:'#9333EA', meeting:'#F472B6',
  study:'#7C3AED',   service:'#1D4ED8', wedding:'#0284C7', travel:'#9A3412',
  meal:'#B45309',    task:'#65A30D',    other:'#6B7280'
};

const DOT_KEYS = ['yellow','green','lightblue','darkblue','purple','gray','red'];

// These get overridden from API on People page
let DOT_COLOR = {
  yellow:'#EAB308', green:'#22C55E', lightblue:'#7DD3FC',
  darkblue:'#1D4ED8', purple:'#A855F7', gray:'#9CA3AF', red:'#EF4444'
};
let DOT_LABEL = {
  yellow:'Contact (active)', green:'2 dates done', lightblue:'Engaged',
  darkblue:'Married / Family', purple:'Platonic friend', gray:'Inactive', red:'Do not contact'
};

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id)  { const m = document.getElementById(id); if (m) m.classList.add('show'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('show'); }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toDateStr(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function setTimeFields(form, dateObj, prefix='start') {
  if (!dateObj) return;
  const hr24 = dateObj.getHours();
  const min  = String(dateObj.getMinutes()).padStart(2,'0');
  const ampm = hr24 >= 12 ? 'PM' : 'AM';
  let hr12 = hr24 % 12; if (!hr12) hr12 = 12;
  form[prefix+'_hour'].value   = hr12;
  form[prefix+'_minute'].value = min;
  form[prefix+'_ampm'].value   = ampm;
}
function buildDatetime(dateStr, h, m, ampm) {
  if (!dateStr || !h) return null;
  let hour = parseInt(h, 10);
  if (ampm==='PM' && hour!==12) hour += 12;
  if (ampm==='AM' && hour===12) hour = 0;
  return `${dateStr}T${String(hour).padStart(2,'0')}:${String(m||'00').padStart(2,'0')}:00`;
}
function getWeekKey() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day===0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return monday.toISOString().slice(0,10);
}
function escapeHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function normalizeGoal(g) {
  return {
    ...g,
    uiType: g.ui_type || 'counter',
    calCat: g.cal_cat || null,
    periodOptions: g.period_options ? g.period_options.split(',').filter(Boolean) : [],
    defaultGoal: g.goal_value || 1,
    defaultPeriod: g.goal_period || 'weekly',
    counterLabel: g.description || (g.name + ' count'),
    toggleLabel: g.description || ('Did you complete ' + g.name + '?')
  };
}

// ─── Recurring event expansion ────────────────────────────────────────────────
function getNthWeekdayOfMonth(year, month, n, dayOfWeek) {
  if (n > 0) {
    const first = new Date(year, month, 1);
    let diff = dayOfWeek - first.getDay(); if (diff < 0) diff += 7;
    const result = new Date(year, month, 1 + diff + (n-1)*7);
    return result.getMonth() === month ? result : null;
  } else {
    const last = new Date(year, month+1, 0);
    let diff = last.getDay() - dayOfWeek; if (diff < 0) diff += 7;
    const result = new Date(year, month+1, -diff);
    return result.getMonth() === month ? result : null;
  }
}

function expandRecurring(events) {
  const expanded = [];
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear()+2);
  events.forEach(ev => {
    if (!ev.recur || ev.recur==='none') { expanded.push(ev); return; }
    const recurEnd = ev.recur_end ? new Date(ev.recur_end+'T23:59:59') : cutoff;
    const limit = recurEnd < cutoff ? recurEnd : cutoff;
    const start = new Date(ev.start);
    const duration = ev.end ? (new Date(ev.end) - start) : 0;
    let cfg = {}; try { cfg = JSON.parse(ev.recur_config || '{}'); } catch {}
    const exceptions = new Set();
    try { JSON.parse(ev.recur_exceptions||'[]').forEach(d=>exceptions.add(d.slice(0,10))); } catch {}
    let idx = 0;
    function addInst(dt) {
      if (idx >= 500) return;
      const key = dt.toISOString().slice(0,10);
      if (!exceptions.has(key)) {
        const instEnd = duration ? new Date(dt.getTime()+duration) : null;
        expanded.push({...ev, _instanceId:`recur-${ev.id}-${idx}`, _originalId:ev.id,
          start:dt.toISOString(), end:instEnd?instEnd.toISOString():null, _instanceDate:key,
          _masterStart:ev.start, _masterEnd:ev.end});
        idx++;
      }
    }
    if (ev.recur==='weekly' && cfg.days && cfg.days.length>0) {
      const ws = new Date(start); ws.setHours(0,0,0,0); ws.setDate(ws.getDate()-ws.getDay());
      while (ws<=limit && idx<500) {
        for (const d of [...cfg.days].sort((a,b)=>a-b)) {
          const c=new Date(ws); c.setDate(ws.getDate()+d); c.setHours(start.getHours(),start.getMinutes(),start.getSeconds(),0);
          if (c>=start && c<=limit) addInst(c);
        }
        ws.setDate(ws.getDate()+7);
      }
    } else if (ev.recur==='monthly' && cfg.type==='weekday' && cfg.n!=null && cfg.day!=null) {
      let mo = new Date(start.getFullYear(), start.getMonth(), 1);
      while (mo<=limit && idx<500) {
        const dt=getNthWeekdayOfMonth(mo.getFullYear(),mo.getMonth(),cfg.n,cfg.day);
        if (dt) { dt.setHours(start.getHours(),start.getMinutes(),start.getSeconds(),0); if(dt>=start&&dt<=limit) addInst(dt); }
        mo.setMonth(mo.getMonth()+1);
      }
    } else {
      let current = new Date(start);
      while (current<=limit && idx<500) {
        addInst(new Date(current));
        switch(ev.recur) {
          case 'daily':   current.setDate(current.getDate()+1); break;
          case 'weekly':  current.setDate(current.getDate()+7); break;
          case 'monthly': current.setMonth(current.getMonth()+1); break;
          case 'yearly':  current.setFullYear(current.getFullYear()+1); break;
          default: current = new Date(limit.getTime()+1);
        }
      }
    }
  });
  return expanded;
}

// ─── Auto dot-color update ────────────────────────────────────────────────────
async function autoDotCheckAll() {
  const [pRes, eRes, dsRes] = await Promise.all([
    fetch('/api/people'), fetch('/api/events'), fetch('/api/dot-settings')
  ]);
  const people = await pRes.json();
  const events = await eRes.json();
  const ds = await dsRes.json();
  // Update local DOT_COLOR/DOT_LABEL from settings
  DOT_KEYS.forEach(k => {
    if (ds[`dot_${k}_color`]) DOT_COLOR[k] = ds[`dot_${k}_color`];
    if (ds[`dot_${k}_label`]) DOT_LABEL[k]  = ds[`dot_${k}_label`];
  });
  const datesForGreen = parseInt(ds['dates_for_green'] || '2', 10);
  const now = new Date();
  const updates = [];
  people.forEach(person => {
    const pastDates = events.filter(ev =>
      String(ev.person_id)===String(person.id) && ev.category==='social' && ev.start && new Date(ev.start)<=now
    ).length;
    let newDot = person.dot;
    if (pastDates >= datesForGreen && person.dot==='yellow') newDot = 'green';
    if (pastDates === 0           && person.dot==='green')  newDot = 'yellow';
    if (newDot !== person.dot) {
      updates.push(fetch('/api/people', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:person.id, dot:newDot, notes:person.notes||''})}));
    }
  });
  await Promise.all(updates);
}

async function autoDotCheck(personId) {
  const [pRes, eRes, dsRes] = await Promise.all([
    fetch('/api/people'), fetch('/api/events'), fetch('/api/dot-settings')
  ]);
  const people = await pRes.json();
  const events = await eRes.json();
  const ds     = await dsRes.json();
  const datesForGreen = parseInt(ds['dates_for_green']||'2',10);
  const now = new Date();
  const person = people.find(p => String(p.id)===String(personId));
  if (!person) return;
  const pastDates = events.filter(ev =>
    String(ev.person_id)===String(personId) && ev.category==='social' && ev.start && new Date(ev.start)<=now
  ).length;
  let newDot = person.dot;
  if (pastDates >= datesForGreen && person.dot==='yellow') newDot = 'green';
  if (pastDates === 0            && person.dot==='green')  newDot = 'yellow';
  if (newDot !== person.dot) {
    await fetch('/api/people', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:person.id, dot:newDot, notes:person.notes||''})});
  }
}

// ══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {

  // ─── Calendar ──────────────────────────────────────────────────────────────
  const calendarEl = document.getElementById('calendar');
  if (calendarEl) {
    let categoryColorMap = {...FALLBACK_CAT_COLORS};
    let allCats = [];
    let calInstance = null;

    function populatePersonSelect(selectedId='') {
      const sel = document.getElementById('personSelect');
      if (!sel) return;
      fetch('/api/people').then(r=>r.json()).then(people => {
        sel.innerHTML = '<option value="">— no one attached —</option>';
        people.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id; opt.textContent = p.name;
          if (String(p.id)===String(selectedId)) opt.selected = true;
          sel.appendChild(opt);
        });
      });
    }

    function openEventModal() { openModal('eventModal'); }

    // Close modal
    ['modalBackdrop','modalClose','closeEvent'].forEach(id =>
      document.getElementById(id)?.addEventListener('click', ()=>closeModal('eventModal'))
    );

    // Recurrence toggle
    // ── Recurrence UI helpers ─────────────────────────────────────────────────
    let _editScope = 'all';        // 'all' | 'one'
    let _editInstanceDate = null;  // ISO date string of clicked instance
    let _editOriginalId = null;    // master event id for recurring
    let _masterStartDate = null;   // YYYY-MM-DD of master event's original start
    let _masterEndDate   = null;   // YYYY-MM-DD of master event's original end

    function updateRecurUI(recurVal, startDate) {
      document.getElementById('recurEndWrap').style.display = recurVal==='none' ? 'none' : 'block';
      document.getElementById('recurWeekDaysWrap').style.display = recurVal==='weekly' ? 'block' : 'none';
      document.getElementById('recurMonthlyWrap').style.display = recurVal==='monthly' ? 'block' : 'none';
      if (recurVal==='weekly' && startDate) {
        const checked = document.querySelectorAll('#recurWeekDaysWrap input[name="rday"]:checked');
        if (checked.length===0) {
          const d = document.querySelector(`#recurWeekDaysWrap input[value="${new Date(startDate).getDay()}"]`);
          if (d) d.checked = true;
        }
      }
      if (recurVal==='monthly') updateMonthlyDesc(startDate ? new Date(startDate) : null);
    }

    function updateMonthlyDesc(date) {
      const desc = document.getElementById('recurMonthlyDesc'); if (!desc) return;
      const type = document.getElementById('recurMonthlyType')?.value||'date';
      if (!date) { desc.textContent=''; return; }
      if (type==='date') {
        const d=date.getDate(), s=d===1||d===21||d===31?'st':d===2||d===22?'nd':d===3||d===23?'rd':'th';
        desc.textContent=`Every ${d}${s} of the month`;
      } else {
        const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const n=Math.ceil(date.getDate()/7);
        const nth=n===1?'1st':n===2?'2nd':n===3?'3rd':n===4?'4th':'last';
        desc.textContent=`Every ${nth} ${days[date.getDay()]} of the month`;
      }
    }

    function buildRecurConfig(recur, startDate) {
      if (recur==='weekly') {
        const days=[];
        document.querySelectorAll('#recurWeekDaysWrap input[name="rday"]:checked').forEach(cb=>days.push(parseInt(cb.value)));
        return days.length ? JSON.stringify({days:days.sort((a,b)=>a-b)}) : null;
      }
      if (recur==='monthly') {
        const type=document.getElementById('recurMonthlyType')?.value||'date';
        if (type==='weekday' && startDate) {
          const d=new Date(startDate);
          return JSON.stringify({type:'weekday',n:Math.ceil(d.getDate()/7),day:d.getDay()});
        }
        return JSON.stringify({type:'date'});
      }
      return null;
    }

    document.getElementById('recurSelect')?.addEventListener('change', function() {
      const startDate = document.getElementById('eventForm')?.start_date?.value;
      updateRecurUI(this.value, startDate ? startDate+'T12:00:00' : null);
    });
    document.getElementById('recurMonthlyType')?.addEventListener('change', function(){
      const startDate = document.getElementById('eventForm')?.start_date?.value;
      updateMonthlyDesc(startDate ? new Date(startDate+'T12:00:00') : null);
    });

    // Scope bar buttons
    document.getElementById('scopeOneBtn')?.addEventListener('click', function(){
      _editScope='one';
      this.className='btn btn-primary btn-sm'; this.style.fontSize='0.73rem';
      const all=document.getElementById('scopeAllBtn');
      all.className='btn btn-secondary btn-sm'; all.style.fontSize='0.73rem';
    });
    document.getElementById('scopeAllBtn')?.addEventListener('click', function(){
      _editScope='all';
      this.className='btn btn-primary btn-sm'; this.style.fontSize='0.73rem';
      const one=document.getElementById('scopeOneBtn');
      one.className='btn btn-secondary btn-sm'; one.style.fontSize='0.73rem';
    });

    function resetForm(date) {
      const form = document.getElementById('eventForm');
      form.id.value=''; form.title.value=''; form.notes.value='';
      const ds = toDateStr(date); form.start_date.value=ds; form.end_date.value=ds;
      setTimeFields(form, date);
      setTimeFields(form, new Date(date.getTime()+3600000), 'end');
      document.getElementById('recurSelect').value='none';
      form.recur_end.value='';
      document.querySelectorAll('#recurWeekDaysWrap input[name="rday"]').forEach(cb=>cb.checked=false);
      updateRecurUI('none', null);
      document.getElementById('deleteEvent').style.display='none';
      document.getElementById('deleteOneEvent').style.display='none';
      document.getElementById('recurScopeBar').style.display='none';
      document.getElementById('isBackupCheck').checked=false;
      const tcw=document.getElementById('taskCompleteWrap'); if(tcw){tcw.style.display='none'; document.getElementById('taskCompleteCheck').checked=false;}
      document.getElementById('modalHeading').textContent='New Event';
      _editScope='all'; _editInstanceDate=null; _editOriginalId=null; _masterStartDate=null; _masterEndDate=null;
      populatePersonSelect('');
    }

    document.getElementById('fabAdd')?.addEventListener('click', () => { resetForm(new Date()); openEventModal(); });

    function updateLegend(cats) {
      // legend removed from planner — no-op
      return; cats.forEach(c => {
        const span = document.createElement('span');
        span.innerHTML = `<span class="dot" style="background:${c.color};"></span>${escapeHtml(c.emoji+' '+c.name)}`;
        legend.appendChild(span);
      });
    }

    async function initCalendar() {
      const catRes = await fetch('/api/categories');
      allCats = await catRes.json();
      categoryColorMap = {};
      allCats.forEach(c => { categoryColorMap[c.key] = c.color; });
      updateLegend(allCats);

      // Populate category select in modal
      const catSel = document.getElementById('eventCategorySelect');
      if (catSel) {
        catSel.innerHTML = '';
        allCats.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.key;
          opt.textContent = `${c.emoji||''} ${c.name}`.trim();
          catSel.appendChild(opt);
        });
        catSel.addEventListener('change', function() {
          const tw = document.getElementById('taskCompleteWrap');
          if (tw) tw.style.display = this.value === 'task' ? 'flex' : 'none';
        });
      }

      const savedView = localStorage.getItem('calView') || (window.innerWidth < 700 ? 'timeGridDay' : 'timeGridWeek');
      calInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: savedView,
        headerToolbar: { left:'prev,next today', center:'title', right:'timeGridDay,timeGridWeek,dayGridMonth,listWeek' },
        navLinks: true, nowIndicator: true, selectable: true, editable: true,
        selectMirror: true, height: 'auto',
        viewDidMount: function(info) { localStorage.setItem('calView', info.view.type); },

        select: function(info) {
          if (window.innerWidth < 700) { openMobileSheet(info.start); return; }
          resetForm(info.start);
          const form = document.getElementById('eventForm');
          form.start_date.value = toDateStr(info.start);
          form.end_date.value   = toDateStr(info.start);
          setTimeFields(form, info.start);
          setTimeFields(form, info.end||new Date(info.start.getTime()+3600000),'end');
          openEventModal();
        },
        dateClick: function(info) {
          if (window.innerWidth < 700) { openMobileSheet(info.date); return; }
          resetForm(info.date);
          openEventModal();
        },
        eventClick: function(info) {
          const e = info.event; const p = e.extendedProps;
          const isRecurring = p.recur && p.recur !== 'none';
          const form = document.getElementById('eventForm');
          _editOriginalId = p.originalId||e.id;
          _editInstanceDate = p._instanceDate||null;
          _editScope = 'all';
          _masterStartDate = p.masterStart ? p.masterStart.slice(0,10) : null;
          _masterEndDate   = p.masterEnd   ? p.masterEnd.slice(0,10)   : null;
          form.id.value = _editOriginalId;
          form.title.value = e.title;
          form.notes.value = p.notes||'';
          const catSel2 = document.getElementById('eventCategorySelect');
          if (catSel2) catSel2.value = p.category||'study';
          if (e.start) { form.start_date.value=toDateStr(e.start); setTimeFields(form,e.start); }
          if (e.end)   { form.end_date.value=toDateStr(e.end);     setTimeFields(form,e.end,'end'); }
          const rSel = document.getElementById('recurSelect');
          if (rSel) rSel.value = p.recur||'none';
          form.recur_end.value = p.recur_end||'';
          // Populate recur_config UI
          let cfg={}; try{cfg=JSON.parse(p.recur_config||'{}');}catch{}
          if (p.recur==='weekly' && cfg.days) {
            document.querySelectorAll('#recurWeekDaysWrap input[name="rday"]').forEach(cb=>{cb.checked=cfg.days.includes(parseInt(cb.value));});
          }
          if (p.recur==='monthly') {
            const ms=document.getElementById('recurMonthlyType'); if(ms) ms.value=cfg.type||'date';
          }
          updateRecurUI(p.recur||'none', e.start);
          populatePersonSelect(p.person_id||'');
          document.getElementById('isBackupCheck').checked = !!p.is_backup;
          // Task complete checkbox
          const taskWrap = document.getElementById('taskCompleteWrap');
          if (taskWrap) {
            taskWrap.style.display = p.category === 'task' ? 'flex' : 'none';
            document.getElementById('taskCompleteCheck').checked = !!p.completed;
          }
          // Scope bar
          const scopeBar = document.getElementById('recurScopeBar');
          scopeBar.style.display = isRecurring ? 'flex' : 'none';
          if (isRecurring) {
            document.getElementById('scopeAllBtn').className='btn btn-primary btn-sm'; document.getElementById('scopeAllBtn').style.fontSize='0.73rem';
            document.getElementById('scopeOneBtn').className='btn btn-secondary btn-sm'; document.getElementById('scopeOneBtn').style.fontSize='0.73rem';
          }
          document.getElementById('deleteEvent').style.display='inline-flex';
          document.getElementById('deleteOneEvent').style.display = isRecurring ? 'inline-flex' : 'none';
          document.getElementById('modalHeading').textContent = isRecurring ? 'Edit Recurring Event' : 'Edit Event';
          openEventModal();
        },
        eventContent: function(arg) {
          const p = arg.event.extendedProps;
          const isTask = p.category === 'task';
          const isDone = isTask && p.completed;
          const wrap = document.createElement('div');
          wrap.style.cssText='padding:1px 3px;overflow:hidden;';
          const t = document.createElement('div');
          t.style.cssText=`font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.78rem;${isDone?'text-decoration:line-through;opacity:0.65;':''}`;
          if (isDone) {
            t.innerHTML = `<span style="font-size:0.65rem;background:#65A30D;color:#fff;border-radius:3px;padding:0 3px;margin-right:3px;">✓</span>${escapeHtml(arg.event.title)}`;
          } else if (isTask) {
            t.innerHTML = `<span style="font-size:0.65rem;border:1px solid rgba(255,255,255,0.6);border-radius:3px;padding:0 3px;margin-right:3px;">☐</span>${escapeHtml(arg.event.title)}`;
          } else {
            t.textContent = arg.event.title;
          }
          wrap.appendChild(t);
          if (p.notes) {
            const n = document.createElement('div');
            n.style.cssText='font-size:0.68rem;opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            n.textContent = p.notes;
            wrap.appendChild(n);
          }
          return { domNodes: [wrap] };
        },
        eventDrop: function(info) {
          const e=info.event;
          fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:e.id,start:e.start?.toISOString(),end:e.end?.toISOString()})});
        },
        eventResize: function(info) {
          const e=info.event;
          fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:e.id,start:e.start?.toISOString(),end:e.end?.toISOString()})});
        },
        events: function(fetchInfo, successCallback) {
          fetch('/api/events').then(r=>r.json()).then(data => {
            successCallback(expandRecurring(data).map(e => ({
              id: e._instanceId||e.id,
              title: e.title,
              start: e.start, end: e.end,
              allDay: !e.start || !e.start.includes('T'),
              backgroundColor: categoryColorMap[e.category]||'#6B7280',
              borderColor:     categoryColorMap[e.category]||'#6B7280',
              textColor: '#fff',
              classNames: e.is_backup ? ['backup-event'] : [],
              extendedProps: { notes:e.notes, category:e.category, recur:e.recur||'none',
                recur_end:e.recur_end||'', recur_config:e.recur_config||'{}',
                person_id:e.person_id||'', is_backup:e.is_backup||0, completed:e.completed||0,
                _instanceDate:e._instanceDate||null, originalId:e._originalId||e.id,
                masterStart:e._masterStart||null, masterEnd:e._masterEnd||null }
            })));
          });
        },
        eventsSet: function(fcEvents) {
          if (!calInstance) return;
          const view = calInstance.view;
          const viewStart = view.currentStart;
          const viewEnd   = view.currentEnd;
          let earliest = null;
          fcEvents.forEach(e => {
            if (!e.start || e.allDay) return;
            if (e.start >= viewStart && e.start < viewEnd) {
              if (!earliest || e.start < earliest) earliest = e.start;
            }
          });
          const h = earliest ? Math.max(0, earliest.getHours() - 1) : 7;
          calInstance.scrollToTime(`${String(h).padStart(2,'0')}:00:00`);
        }
      });
      calInstance.render();

      // ── Mobile touch: swipe left/right to navigate ──────────────────────────
      (function addCalendarTouch() {
        let txStart = 0, tyStart = 0;
        calendarEl.addEventListener('touchstart', e => {
          txStart = e.touches[0].clientX;
          tyStart = e.touches[0].clientY;
        }, { passive: true });
        calendarEl.addEventListener('touchend', e => {
          const dx = e.changedTouches[0].clientX - txStart;
          const dy = e.changedTouches[0].clientY - tyStart;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            dx < 0 ? calInstance.next() : calInstance.prev();
          }
        }, { passive: true });
      })();

      // ── Mobile touch: pinch to switch view (spread=zoom in, pinch=zoom out) ─
      (function addCalendarPinch() {
        let pinchStartDist = 0;
        calendarEl.addEventListener('touchstart', e => {
          if (e.touches.length === 2) {
            pinchStartDist = Math.hypot(
              e.touches[0].clientX - e.touches[1].clientX,
              e.touches[0].clientY - e.touches[1].clientY);
          }
        }, { passive: true });
        calendarEl.addEventListener('touchend', e => {
          if (!pinchStartDist || e.changedTouches.length < 2) { pinchStartDist = 0; return; }
          const endDist = Math.hypot(
            e.changedTouches[0].clientX - e.changedTouches[1].clientX,
            e.changedTouches[0].clientY - e.changedTouches[1].clientY);
          const views = ['dayGridMonth','timeGridWeek','timeGridDay'];
          const idx = views.indexOf(calInstance.view.type);
          if (endDist > pinchStartDist + 40 && idx < views.length - 1)
            calInstance.changeView(views[idx + 1]);
          else if (endDist < pinchStartDist - 40 && idx > 0)
            calInstance.changeView(views[idx - 1]);
          pinchStartDist = 0;
        }, { passive: true });
      })();

      // ── Mobile event bottom sheet ─────────────────────────────────────────
      let _msStartDate = null, _msCategory = null, _msDurationSteps = 4;

      function openMobileSheet(startDate) {
        _msStartDate = new Date(startDate);
        _msCategory = null;
        _msDurationSteps = 4;
        buildMsDateStrip(_msStartDate);
        buildMsCatGrid();
        document.getElementById('msStep1').style.display = '';
        document.getElementById('msStep2').style.display = 'none';
        document.getElementById('msDateStrip').style.display = 'none';
        document.getElementById('msStepTitle').textContent = 'Choose Type';
        document.getElementById('msSave').disabled = true;
        document.getElementById('msTitleInput').value = '';
        document.getElementById('msNotesInput').value = '';
        document.getElementById('msDurationSlider').value = 4;
        document.querySelectorAll('.ms-quick-durations button').forEach(b => b.classList.toggle('active', b.dataset.steps === '4'));
        document.getElementById('mobileSheet').classList.add('open');
        document.getElementById('msBackdrop').style.display = 'block';
      }

      function closeMobileSheet() {
        document.getElementById('mobileSheet').classList.remove('open');
        document.getElementById('msBackdrop').style.display = 'none';
      }

      function buildMsDateStrip(centerDate) {
        const strip = document.getElementById('msDateStrip');
        strip.innerHTML = '';
        const days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        for (let i = -3; i <= 3; i++) {
          const d = new Date(centerDate); d.setDate(d.getDate() + i);
          const chip = document.createElement('div');
          chip.className = 'ms-date-chip' + (i === 0 ? ' active' : '');
          if (i === 0 && _msCategory) chip.style.background = categoryColorMap[_msCategory] || '#6B7280';
          chip.innerHTML = `<div style="font-size:0.62rem;opacity:0.7;">${days[d.getDay()]}</div><div>${d.getDate()}</div>`;
          chip.addEventListener('click', () => {
            _msStartDate = new Date(centerDate);
            _msStartDate.setDate(centerDate.getDate() + i);
            buildMsDateStrip(_msStartDate);
            updateMsTimeDisplay();
          });
          strip.appendChild(chip);
        }
        setTimeout(() => {
          const active = strip.querySelector('.active');
          if (active) active.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
        }, 50);
      }

      function buildMsCatGrid() {
        const grid = document.getElementById('msCatGrid');
        grid.innerHTML = '';
        allCats.forEach(cat => {
          const tile = document.createElement('div');
          tile.className = 'ms-cat-tile';
          tile.style.background = categoryColorMap[cat.key] || '#6B7280';
          tile.innerHTML = `<div style="font-size:1.4rem;">${cat.emoji||'📅'}</div><div class="ms-cat-name">${escapeHtml(cat.name)}</div>`;
          tile.addEventListener('click', () => selectMsCategory(cat.key, cat));
          grid.appendChild(tile);
        });
      }

      function selectMsCategory(key, cat) {
        _msCategory = key;
        document.getElementById('msStep1').style.display = 'none';
        document.getElementById('msStep2').style.display = '';
        document.getElementById('msDateStrip').style.display = '';
        document.getElementById('msStepTitle').textContent = cat ? cat.name : key;
        document.getElementById('msTimeBlock').style.background = categoryColorMap[key] || '#6B7280';
        document.getElementById('msSave').disabled = false;
        buildMsDateStrip(_msStartDate);
        updateMsTimeDisplay();
        document.getElementById('msTitleInput').focus();
      }

      function updateMsTimeDisplay() {
        if (!_msStartDate) return;
        const startMin = _msStartDate.getHours() * 60 + _msStartDate.getMinutes();
        const endMin = startMin + _msDurationSteps * 15;
        const fmt = m => { const h=Math.floor(m/60)%24, mn=m%60, ap=h>=12?'PM':'AM', h12=h%12||12; return `${h12}:${String(mn).padStart(2,'0')} ${ap}`; };
        document.getElementById('msTimeStart').textContent = fmt(startMin);
        document.getElementById('msTimeEnd').textContent = fmt(endMin);
        const pct = Math.min(100, (_msDurationSteps / 32) * 100);
        document.getElementById('msTimeBlock').style.width = pct + '%';
      }

      document.getElementById('msDurationSlider')?.addEventListener('input', function() {
        _msDurationSteps = parseInt(this.value);
        document.querySelectorAll('.ms-quick-durations button').forEach(b => b.classList.remove('active'));
        updateMsTimeDisplay();
      });

      document.querySelectorAll('.ms-quick-durations button').forEach(btn => {
        btn.addEventListener('click', () => {
          _msDurationSteps = parseInt(btn.dataset.steps);
          document.getElementById('msDurationSlider').value = _msDurationSteps;
          document.querySelectorAll('.ms-quick-durations button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          updateMsTimeDisplay();
        });
      });

      document.getElementById('msClose')?.addEventListener('click', closeMobileSheet);
      document.getElementById('msBackdrop')?.addEventListener('click', closeMobileSheet);

      document.getElementById('msSave')?.addEventListener('click', async () => {
        const title = document.getElementById('msTitleInput').value.trim();
        if (!title || !_msCategory || !_msStartDate) return;
        const start = new Date(_msStartDate);
        const end = new Date(start.getTime() + _msDurationSteps * 15 * 60000);
        await fetch('/api/events', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            title, category: _msCategory,
            start: start.toISOString(), end: end.toISOString(),
            notes: document.getElementById('msNotesInput').value,
            recur: 'none', completed: 0
          })
        });
        closeMobileSheet();
        calInstance.refetchEvents();
      });
    }

    // Save event
    document.getElementById('saveEvent').addEventListener('click', async function() {
      const form = document.getElementById('eventForm');
      const rSel = document.getElementById('recurSelect');
      const recur = (rSel && _editScope==='all') ? rSel.value : 'none';
      const pSel = document.getElementById('personSelect');
      const catSel2 = document.getElementById('eventCategorySelect');
      // For 'all' scope on a recurring event, lock to master's original date (only allow time changes)
      const startDatePart = (_editScope==='all' && _masterStartDate) ? _masterStartDate : form.start_date.value;
      const endDatePart   = (_editScope==='all' && _masterEndDate)   ? _masterEndDate   : form.end_date.value;
      const start = buildDatetime(startDatePart, form.start_hour.value, form.start_minute.value, form.start_ampm.value);
      const end   = buildDatetime(endDatePart,   form.end_hour.value,   form.end_minute.value,   form.end_ampm.value) || null;
      const payload = {
        // For 'one' scope: no id → creates new one-off event
        id: _editScope==='one' ? '' : form.id.value,
        title: form.title.value,
        start: start,
        end:   end,
        category: catSel2 ? catSel2.value : (form.category?.value||'study'),
        notes: form.notes.value,
        recur: recur,
        recur_end: (recur!=='none'&&form.recur_end.value) ? form.recur_end.value : null,
        recur_config: buildRecurConfig(recur, start),
        person_id: pSel ? (pSel.value||null) : null,
        is_backup: document.getElementById('isBackupCheck')?.checked ? 1 : 0,
        completed: document.getElementById('taskCompleteCheck')?.checked ? 1 : 0
      };
      await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      // If editing just this occurrence, add exception to master so original series skips this date
      if (_editScope==='one' && _editOriginalId && _editInstanceDate) {
        await fetch(`/api/events/${_editOriginalId}/exception`,{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({date:_editInstanceDate})});
      }
      calInstance.refetchEvents();
      closeModal('eventModal');
      if (payload.person_id && payload.category==='dates') autoDotCheck(payload.person_id);
    });

    document.getElementById('deleteEvent').addEventListener('click', async function() {
      const id = _editOriginalId || document.getElementById('eventForm').id.value;
      if (!id) return;
      if (!confirm('Delete all occurrences of this event?')) return;
      await fetch('/api/events?id='+id,{method:'DELETE'});
      calInstance.refetchEvents(); closeModal('eventModal');
    });

    document.getElementById('deleteOneEvent').addEventListener('click', async function() {
      if (!_editOriginalId || !_editInstanceDate) return;
      await fetch(`/api/events/${_editOriginalId}/exception`,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({date:_editInstanceDate})});
      calInstance.refetchEvents(); closeModal('eventModal');
    });

    initCalendar();

    document.getElementById('copyShareLink')?.addEventListener('click', function(){
      const url = window.location.origin + '/calendar/share/' + encodeURIComponent(window.LMG_USER||'');
      navigator.clipboard.writeText(url).then(()=>{
        this.textContent = '✓ Copied!';
        setTimeout(()=>{ this.textContent = '🔗 Copy Share Link'; }, 2000);
      });
    });
  }

  // ─── Home — Weekly Indicators ──────────────────────────────────────────────
  const indicatorsCard = document.getElementById('indicatorsCard');
  if (indicatorsCard) {
    const weekKey = getWeekKey();
    const weekLabel = document.getElementById('weekLabel');
    if (weekLabel) {
      const monday = new Date(weekKey+'T00:00:00');
      const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
      const fmt = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      weekLabel.textContent = `Week of ${fmt(monday)} – ${fmt(sunday)}`;
    }

    let currentGoals = [];
    let dbValues    = {};
    let autoValues  = {};
    const PERIOD_LABEL = {daily:'/day',weekly:'/wk',monthly:'/mo',bimonthly:'/2mo'};

    function effectiveValue(ind) { return Math.max(dbValues[ind.name]??0, autoValues[ind.name]??0); }

    function renderIndicators() {
      indicatorsCard.innerHTML='';
      currentGoals.forEach(g => {
        const ind = normalizeGoal(g);
        const val  = effectiveValue(ind);
        const isAuto = (autoValues[ind.name]??0)>0 && (dbValues[ind.name]??0)<=(autoValues[ind.name]??0);
        let bText, bCls;
        if (ind.uiType==='toggle') { bText=val?'✓':'—'; bCls=val?'done':''; }
        else {
          bText=`${val}/${ind.defaultGoal}`; bCls=val===0?'':val>=ind.defaultGoal?'done':'partial';
        }
        const pTag = ind.uiType==='counter' ? `<span style="font-size:0.62rem;color:var(--text-muted);">${PERIOD_LABEL[ind.defaultPeriod]||''}</span>` : '';
        const autoHint = isAuto ? ' <span style="font-size:0.62rem;color:var(--text-muted);">· calendar</span>' : '';
        const row = document.createElement('div');
        row.className='indicator-row'; row.style.cursor='pointer';
        row.innerHTML=`
          <div class="ind-icon" style="background:${ind.bg_color};">${ind.icon}</div>
          <div style="flex:1;"><div class="ind-label">${escapeHtml(ind.name)}${autoHint}</div></div>
          <div class="ind-value ${bCls}">${bText}${pTag}</div>`;
        row.addEventListener('click', ()=>openIndicatorModal(ind));
        indicatorsCard.appendChild(row);
      });
    }

    // ── Indicator Modal ───────────────────────────────────────────────────────
    let _activeInd=null, _modalVal=0;

    function openIndicatorModal(ind) {
      _activeInd=ind; _modalVal=effectiveValue(ind);
      document.getElementById('indModalIcon').textContent=ind.icon;
      document.getElementById('indModalName').textContent=ind.name;
      const counterSec = document.getElementById('indCounterSection');
      const toggleSec  = document.getElementById('indToggleSection');
      if (ind.uiType==='counter') {
        counterSec.style.display=''; toggleSec.style.display='none';
        document.getElementById('indCounterLabel').textContent = ind.counterLabel;
        document.getElementById('indCurrentVal').textContent   = _modalVal;
        document.getElementById('indGoalDisp').textContent     = ind.defaultGoal;
        document.getElementById('indGoalValue').value          = ind.defaultGoal;
        const pWrap = document.getElementById('indPeriodWrap');
        const pSel  = document.getElementById('indGoalPeriod');
        if (ind.periodOptions.length) {
          pWrap.style.display='';
          pSel.innerHTML='';
          const PL={daily:'Day',weekly:'Week',monthly:'Month',bimonthly:'2 Months'};
          ind.periodOptions.forEach(p=>{
            const opt=document.createElement('option'); opt.value=p; opt.textContent=PL[p]||p;
            if (p===ind.defaultPeriod) opt.selected=true; pSel.appendChild(opt);
          });
        } else { pWrap.style.display='none'; }
      } else {
        counterSec.style.display='none'; toggleSec.style.display='';
        document.getElementById('indToggleLabel').textContent=ind.toggleLabel;
        updateToggleBtns(_modalVal);
      }
      openModal('indicatorModal');
    }

    function updateToggleBtns(val) {
      document.getElementById('indToggleYes').className='btn '+(val?'btn-primary':'btn-secondary');
      document.getElementById('indToggleNo').className ='btn '+(val?'btn-secondary':'btn-primary');
    }

    document.getElementById('indIncBtn').addEventListener('click',()=>{
      _modalVal++; document.getElementById('indCurrentVal').textContent=_modalVal;
    });
    document.getElementById('indDecBtn').addEventListener('click',()=>{
      if (_modalVal>0) _modalVal--; document.getElementById('indCurrentVal').textContent=_modalVal;
    });
    document.getElementById('indToggleYes').addEventListener('click',()=>{ _modalVal=1; updateToggleBtns(1); });
    document.getElementById('indToggleNo').addEventListener('click', ()=>{ _modalVal=0; updateToggleBtns(0); });

    ['indClose','indCancelBtn','indBackdrop'].forEach(id=>
      document.getElementById(id).addEventListener('click',()=>closeModal('indicatorModal'))
    );

    document.getElementById('indSaveBtn').addEventListener('click', async ()=>{
      if (!_activeInd) return;
      const ind=_activeInd;
      dbValues[ind.name]=_modalVal;
      const newGoalVal  = parseInt(document.getElementById('indGoalValue')?.value||ind.defaultGoal,10)||ind.defaultGoal;
      const pSel        = document.getElementById('indGoalPeriod');
      const newPeriod   = (ind.periodOptions.length&&pSel) ? pSel.value : ind.defaultPeriod;
      // Update the local goal definition
      const gIdx = currentGoals.findIndex(g=>g.name===ind.name);
      if (gIdx>=0) { currentGoals[gIdx].goal_value=newGoalVal; currentGoals[gIdx].goal_period=newPeriod; }
      renderIndicators(); closeModal('indicatorModal');
      await Promise.all([
        fetch('/api/indicators',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({week:weekKey,name:ind.name,value:_modalVal})}),
        fetch('/api/goals',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id:currentGoals[gIdx]?.id,name:ind.name,goal_value:newGoalVal,goal_period:newPeriod,
            icon:ind.icon,bg_color:ind.bg_color,ui_type:ind.uiType,cal_cat:ind.calCat||'',
            period_options:ind.periodOptions.join(','),description:ind.counterLabel||ind.toggleLabel||''})})
      ]);
    });

    async function loadIndicators() {
      const [goalsRes, indRes, evRes] = await Promise.all([
        fetch('/api/goals'), fetch(`/api/indicators?week=${weekKey}`), fetch('/api/events')
      ]);
      currentGoals = await goalsRes.json();
      const indData = await indRes.json();
      const events  = await evRes.json();
      dbValues = indData.values||{};

      const now = new Date();
      const monday = new Date(weekKey+'T00:00:00');
      const weekEnd = new Date(monday); weekEnd.setDate(monday.getDate()+7);
      autoValues={};
      events.forEach(ev=>{
        if (!ev.start) return;
        const start=new Date(ev.start);
        if (start<monday||start>=weekEnd||start>now) return;
        const g = currentGoals.find(g=>g.cal_cat&&g.cal_cat===ev.category);
        if (!g) return;
        if (g.ui_type==='toggle') autoValues[g.name]=1;
        else autoValues[g.name]=(autoValues[g.name]??0)+1;
      });

      const syncs=[];
      currentGoals.forEach(g=>{
        const auto=autoValues[g.name]??0, db=dbValues[g.name]??0;
        if (auto>db) {
          dbValues[g.name]=auto;
          syncs.push(fetch('/api/indicators',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({week:weekKey,name:g.name,value:auto})}));
        }
      });
      await Promise.all(syncs);
      renderIndicators();
    }
    loadIndicators();

    // ── Progressing People ──────────────────────────────────────────────────
    const ppList = document.getElementById('progressingPeopleList');
    if (ppList) {
      (async () => {
        try {
          const [people, events] = await Promise.all([
            fetch('/api/people').then(r=>r.json()),
            fetch('/api/events').then(r=>r.json())
          ]);
          // For each person find their most recent linked event
          const withActivity = people.map(p => {
            const linked = events.filter(ev=>String(ev.person_id)===String(p.id)&&ev.start);
            const latest = linked.sort((a,b)=>new Date(b.start)-new Date(a.start))[0];
            return {...p, _latestEvent: latest||null};
          }).filter(p=>p._latestEvent).sort((a,b)=>new Date(b._latestEvent.start)-new Date(a._latestEvent.start)).slice(0,4);
          if (!withActivity.length) {
            ppList.innerHTML='<div style="padding:8px 0;color:var(--text-muted);font-size:0.85rem;">No recent activity yet.</div>'; return;
          }
          ppList.innerHTML='';
          const now=new Date();
          withActivity.forEach(p => {
            const ev=p._latestEvent;
            const daysAgo=Math.floor((now-new Date(ev.start))/(1000*86400));
            const ago=daysAgo===0?'Today':daysAgo===1?'Yesterday':`${daysAgo}d ago`;
            const color=DOT_COLOR[p.dot]||'#EAB308';
            const evColor=FALLBACK_CAT_COLORS[ev.category]||'#6B7280';
            const row=document.createElement('a');
            row.href='/people'; row.className='person-row'; row.style.textDecoration='none';
            row.innerHTML=`
              <span class="dot" style="background:${color};"></span>
              <div style="flex:1;min-width:0;">
                <div class="person-name">${escapeHtml(p.name)}</div>
                <div class="person-meta" style="display:flex;align-items:center;gap:5px;">
                  <span style="width:7px;height:7px;border-radius:50%;background:${evColor};display:inline-block;flex-shrink:0;"></span>
                  <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.title||'')}</span>
                </div>
              </div>
              <span style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;">${ago}</span>`;
            ppList.appendChild(row);
          });
        } catch(e) {
          ppList.innerHTML='<div style="color:var(--text-muted);font-size:0.85rem;padding:8px 0;">Could not load.</div>';
        }
      })();
    }
  }

  // ─── People ────────────────────────────────────────────────────────────────
  const addPersonForm = document.getElementById('addPersonForm');
  if (addPersonForm) {
    let _allPeople=[], _allEvents=[];
    let _activePerson=null;

    async function loadPeople() {
      await autoDotCheckAll();
      [_allPeople, _allEvents] = await Promise.all([
        fetch('/api/people').then(r=>r.json()), fetch('/api/events').then(r=>r.json())
      ]);
      renderPeopleList();
    }

    function renderPeopleList() {
      const container=document.getElementById('peopleList');
      if (!_allPeople.length) {
        container.innerHTML='<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No contacts yet.</div>';
        return;
      }
      const now=new Date(); container.innerHTML='';
      _allPeople.forEach(p=>{
        const dotKey=p.dot||'yellow', color=DOT_COLOR[dotKey]||dotKey, label=DOT_LABEL[dotKey]||dotKey;
        const dateCount=_allEvents.filter(ev=>String(ev.person_id)===String(p.id)&&ev.category==='social'&&ev.start&&new Date(ev.start)<=now).length;
        const metInfo=[p.met_where,p.met_when].filter(Boolean).join(' · ');
        const sub=[label,dateCount?`${dateCount} date${dateCount!==1?'s':''}`:'',metInfo].filter(Boolean).join(' · ');
        const row=document.createElement('div'); row.className='person-row';
        row.innerHTML=`
          <span class="dot" style="background:${color};"></span>
          <div style="flex:1;min-width:0;">
            <div class="person-name">${escapeHtml(p.name)}</div>
            <div class="person-meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(sub)}</div>
          </div>
          <svg style="width:16px;height:16px;stroke:var(--text-muted);fill:none;stroke-width:2;flex-shrink:0;" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`;
        row.addEventListener('click',()=>openPersonModal(p));
        container.appendChild(row);
      });
    }

    function openPersonModal(p) {
      _activePerson=p;
      document.getElementById('personModalName').textContent=p.name;
      document.getElementById('personDotEdit').value=p.dot||'yellow';
      document.getElementById('personDotDisplay').style.background=DOT_COLOR[p.dot]||DOT_COLOR.yellow;
      document.getElementById('personMetWhere').value=p.met_where||'';
      document.getElementById('personMetWhen').value=p.met_when||'';
      document.getElementById('personNotes').value=p.notes||'';
      document.getElementById('personPhone').value=p.phone||'';
      document.getElementById('personAddress').value=p.address||'';
      document.getElementById('personBirthday').value=p.birthday||'';
      document.getElementById('personInstagram').value=p.instagram||'';
      document.getElementById('personDotEdit').onchange=function(){
        document.getElementById('personDotDisplay').style.background=DOT_COLOR[this.value]||this.value;
      };
      // Reset to Profile tab
      document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.ptab-panel').forEach(t=>t.style.display='none');
      document.querySelector('.ptab[data-tab="profile"]').classList.add('active');
      document.getElementById('ptab-profile').style.display='';
      renderPersonEventHistory(p);
      openModal('personModal');
    }

    // Tab switching
    document.querySelectorAll('.ptab').forEach(tab => {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
        document.querySelectorAll('.ptab-panel').forEach(t=>t.style.display='none');
        this.classList.add('active');
        document.getElementById('ptab-'+this.dataset.tab).style.display='';
        if (this.dataset.tab === 'progress' && _activePerson) renderPersonProgress(_activePerson);
        if (this.dataset.tab === 'timeline' && _activePerson) renderPersonEventHistory(_activePerson);
      });
    });

    async function renderPersonProgress(p) {
      const panel = document.getElementById('personProgressPanel');
      panel.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Loading…</div>';
      // Stats
      const now = new Date();
      const linked = _allEvents.filter(ev=>String(ev.person_id)===String(p.id)&&ev.start);
      const total = linked.length;
      const outings = linked.filter(ev=>ev.category==='social').length;
      const lastEv = linked.sort((a,b)=>new Date(b.start)-new Date(a.start))[0];
      const daysSince = lastEv ? Math.floor((now-new Date(lastEv.start))/(1000*86400)) : null;
      const dotColor = DOT_COLOR[p.dot]||'#EAB308';
      const dotLabel = DOT_LABEL[p.dot]||p.dot;
      let html = `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
        <div style="flex:1;min-width:80px;text-align:center;background:var(--bg);border-radius:12px;padding:12px 8px;">
          <div style="font-size:1.4rem;font-weight:700;">${total}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Total events</div>
        </div>
        <div style="flex:1;min-width:80px;text-align:center;background:var(--bg);border-radius:12px;padding:12px 8px;">
          <div style="font-size:1.4rem;font-weight:700;">${outings}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Social outings</div>
        </div>
        <div style="flex:1;min-width:80px;text-align:center;background:var(--bg);border-radius:12px;padding:12px 8px;">
          <div style="font-size:1.4rem;font-weight:700;">${daysSince!==null?(daysSince===0?'Today':daysSince+'d'):'—'}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Since last event</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="width:14px;height:14px;border-radius:50%;background:${dotColor};flex-shrink:0;"></div>
        <span style="font-size:0.85rem;font-weight:600;">Current: ${escapeHtml(dotLabel)}</span>
      </div>`;
      // Dot history
      try {
        const histRes = await fetch(`/api/people/${p.id}/dot-history`);
        const hist = await histRes.json();
        if (hist.length) {
          html += `<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:8px;">Status History</div>`;
          hist.reverse().forEach(h => {
            const d = new Date(h.changed_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
            const fc=DOT_COLOR[h.from_dot]||'#9CA3AF', tc=DOT_COLOR[h.to_dot]||'#9CA3AF';
            html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
              <div style="width:10px;height:10px;border-radius:50%;background:${fc};flex-shrink:0;"></div>
              <span style="font-size:0.72rem;color:var(--text-muted);">→</span>
              <div style="width:10px;height:10px;border-radius:50%;background:${tc};flex-shrink:0;"></div>
              <span style="font-size:0.8rem;flex:1;">${escapeHtml(DOT_LABEL[h.to_dot]||h.to_dot)}</span>
              <span style="font-size:0.72rem;color:var(--text-muted);">${d}</span>
            </div>`;
          });
        } else {
          html += `<div style="color:var(--text-muted);font-size:0.83rem;">No status changes recorded yet.</div>`;
        }
      } catch(e) { html += `<div style="color:var(--text-muted);font-size:0.83rem;">Could not load history.</div>`; }
      panel.innerHTML = html;
    }

    function renderPersonEventHistory(p) {
      const container=document.getElementById('personEventHistory');
      const linked=_allEvents.filter(ev=>String(ev.person_id)===String(p.id)&&ev.start)
        .sort((a,b)=>new Date(b.start)-new Date(a.start));
      if (!linked.length) {
        container.innerHTML='<div style="color:var(--text-muted);font-size:0.83rem;padding:4px 0;">No events linked yet.</div>'; return;
      }
      container.innerHTML='';
      const catLabels={contact:'Contact',class:'Class',social:'Social',meeting:'Meeting',study:'Study',service:'Service',wedding:'Wedding',travel:'Travel',meal:'Meal',task:'Task',other:'Other'};
      linked.forEach(ev=>{
        const color=FALLBACK_CAT_COLORS[ev.category]||'#9CA3AF';
        const dateStr=new Date(ev.start).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
        const item=document.createElement('div'); item.className='event-history-item';
        item.innerHTML=`
          <div style="position:relative;display:flex;flex-direction:column;align-items:center;padding-top:4px;">
            <div class="event-history-dot" style="background:${color};"></div>
            <div class="event-history-line"></div>
          </div>
          <div class="event-history-content" style="flex:1;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
              <div class="event-history-title">${escapeHtml(ev.title||'(no title)')}</div>
              <button class="btn-unlink" data-id="${ev.id}" title="Unlink event" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.85rem;padding:0;line-height:1;flex-shrink:0;">✕</button>
            </div>
            <div class="event-history-date">${dateStr} · ${catLabels[ev.category]||ev.category}</div>
            ${ev.notes?`<div class="event-history-notes">${escapeHtml(ev.notes)}</div>`:''}
          </div>`;
        item.querySelector('.btn-unlink').addEventListener('click', async function() {
          const evId = parseInt(this.dataset.id);
          const target = _allEvents.find(x=>x.id===evId);
          if (!target) return;
          await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:evId,title:target.title,start:target.start,end:target.end,
              category:target.category,notes:target.notes||'',person_id:null,
              recur:target.recur||'none',recur_end:target.recur_end||null,
              recur_config:target.recur_config||null,is_backup:target.is_backup||0})});
          const eRes = await fetch('/api/events');
          _allEvents = await eRes.json();
          if (_activePerson) renderPersonEventHistory(_activePerson);
        });
        container.appendChild(item);
      });
    }

    ['personModalClose','personCancelBtn','personModalBackdrop'].forEach(id=>
      document.getElementById(id)?.addEventListener('click',()=>closeModal('personModal'))
    );
    document.getElementById('personSaveBtn').addEventListener('click', async ()=>{
      if (!_activePerson) return;
      await fetch('/api/people',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:_activePerson.id,
          dot:document.getElementById('personDotEdit').value,
          notes:document.getElementById('personNotes').value,
          met_where:document.getElementById('personMetWhere').value,
          met_when:document.getElementById('personMetWhen').value,
          phone:document.getElementById('personPhone').value,
          address:document.getElementById('personAddress').value,
          birthday:document.getElementById('personBirthday').value,
          instagram:document.getElementById('personInstagram').value})});
      closeModal('personModal'); loadPeople();
    });
    document.getElementById('personDeleteBtn').addEventListener('click', async ()=>{
      if (!_activePerson||!confirm(`Delete ${_activePerson.name}?`)) return;
      await fetch(`/api/people/${_activePerson.id}`,{method:'DELETE'});
      closeModal('personModal'); loadPeople();
    });

    // ── Link Event modal ────────────────────────────────────────────────────
    function renderLinkEventList(filter) {
      const list = document.getElementById('linkEventList');
      if (!list) return;
      const candidates = _allEvents
        .filter(ev => !ev.person_id || String(ev.person_id) !== String(_activePerson?.id))
        .filter(ev => ev.start)
        .filter(ev => !filter || (ev.title||'').toLowerCase().includes(filter))
        .sort((a,b) => new Date(b.start) - new Date(a.start))
        .slice(0, 100);
      list.innerHTML = candidates.length
        ? ''
        : '<div style="color:var(--text-muted);font-size:0.85rem;padding:8px 0;">No events found.</div>';
      candidates.forEach(ev => {
        const row = document.createElement('div');
        row.className = 'person-row'; row.style.cursor = 'pointer';
        const d = new Date(ev.start).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        row.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.title||'(no title)')}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);">${d} · ${ev.category||''}</div>
          </div>`;
        row.addEventListener('click', async () => {
          await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:ev.id,title:ev.title,start:ev.start,end:ev.end,
              category:ev.category,notes:ev.notes||'',person_id:_activePerson.id,
              recur:ev.recur||'none',recur_end:ev.recur_end||null,
              recur_config:ev.recur_config||null,is_backup:ev.is_backup||0})});
          const eRes = await fetch('/api/events');
          _allEvents = await eRes.json();
          closeModal('linkEventModal');
          if (_activePerson) renderPersonEventHistory(_activePerson);
        });
        list.appendChild(row);
      });
    }
    document.getElementById('linkEventBtn')?.addEventListener('click', () => {
      document.getElementById('linkEventSearch').value = '';
      renderLinkEventList('');
      openModal('linkEventModal');
    });
    document.getElementById('linkEventClose')?.addEventListener('click', () => closeModal('linkEventModal'));
    document.getElementById('linkEventModalBackdrop')?.addEventListener('click', () => closeModal('linkEventModal'));
    document.getElementById('linkEventSearch')?.addEventListener('input', function() {
      renderLinkEventList(this.value.toLowerCase());
    });

    addPersonForm.addEventListener('submit', async function(e){
      e.preventDefault();
      const nameVal=addPersonForm.name.value.trim(); if (!nameVal) return;
      await fetch('/api/people',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:nameVal,dot:addPersonForm.dot.value,
          met_where:addPersonForm.met_where.value,met_when:addPersonForm.met_when.value})});
      addPersonForm.reset(); loadPeople();
    });
    loadPeople();
  }

  // ─── PMG 13 ────────────────────────────────────────────────────────────────
  const postForm = document.getElementById('postForm');
  if (postForm) {
    const TAG={date_idea:'💡 Date Idea',meme:'😂 Meme/Joke',spiritual:'✨ Spiritual',misc:'💬 Misc'};

    function fmtDate(str) {
      if (!str) return '';
      try { return new Date(str).toLocaleDateString('en-US',{month:'short',day:'numeric'}); } catch{ return ''; }
    }

    // Moderation queue (pending posts)
    async function loadModQueue() {
      const res = await fetch('/api/posts?status=pending');
      const list = await res.json();
      const wrap = document.getElementById('modQueueWrap');
      const queue = document.getElementById('modQueue');
      if (!list.length) { wrap.style.display='none'; return; }
      wrap.style.display='';
      queue.innerHTML='';
      list.forEach(p=>{
        const div=document.createElement('div'); div.className='post-row';
        div.innerHTML=`
          <div class="post-tag">${TAG[p.category]||p.category}</div>
          <div class="post-text">${escapeHtml(p.text)}</div>
          <div class="post-meta" style="margin-top:8px;display:flex;gap:8px;align-items:center;">
            <span>${p.anon?'Anonymous':escapeHtml(p.user)} · ${fmtDate(p.created)}</span>
            <button class="btn btn-primary btn-sm" data-action="approve" data-id="${p.id}">Approve ✓</button>
            <button class="btn btn-danger  btn-sm" data-action="reject"  data-id="${p.id}">Reject ✗</button>
          </div>`;
        div.querySelectorAll('button').forEach(btn=>{
          btn.addEventListener('click', async ()=>{
            await fetch(`/api/posts/${btn.dataset.id}/moderate`,{method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({action:btn.dataset.action})});
            loadModQueue(); loadPosts();
          });
        });
        queue.appendChild(div);
      });
    }

    // Approved posts feed (max 5, no load-more)
    async function loadPosts(resetCount=false) {
      const sort   = document.getElementById('sortSelect')?.value||'newest';
      const filter = document.getElementById('filterSelect')?.value||'';
      let url = `/api/posts?sort=${sort}&status=approved`;
      const res = await fetch(url);
      let list = await res.json();
      if (filter) list = list.filter(p=>p.category===filter);

      const container=document.getElementById('posts');
      if (!list.length) {
        container.innerHTML='<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No posts yet.</div>'; return;
      }
      container.innerHTML='';
      const visible = list.slice(0, 5);
      for (const p of visible) {
        const commRes = await fetch(`/api/comments?post_id=${p.id}`);
        const comments = await commRes.json();
        const div=document.createElement('div'); div.className='post-row';
        const commHtml = comments.map(c=>`
          <div class="comment-item">
            <span class="comment-user">${escapeHtml(c.user)}</span>
            <span class="comment-text">${escapeHtml(c.text)}</span>
          </div>`).join('');
        const imgHtml = p.image ? `<img src="${p.image}" style="max-width:100%;border-radius:10px;margin:8px 0;display:block;max-height:260px;object-fit:cover;"/>` : '';
        div.innerHTML=`
          <div class="post-tag">${TAG[p.category]||p.category}</div>
          <div class="post-text">${escapeHtml(p.text)}</div>
          ${imgHtml}
          <div class="post-meta">${p.anon?'Anonymous':escapeHtml(p.user)}${fmtDate(p.created)?` · ${fmtDate(p.created)}`:''}</div>
          <div class="comment-thread">${commHtml}</div>
          <form class="comment-form" data-post="${p.id}" style="display:flex;gap:6px;margin-top:6px;">
            <input class="form-control" placeholder="Add a comment…" style="flex:1;font-size:0.8rem;padding:6px 10px;" required/>
            <button type="submit" class="btn btn-secondary btn-sm">Reply</button>
          </form>`;
        div.querySelector('.comment-form').addEventListener('submit', async function(e){
          e.preventDefault();
          const input=this.querySelector('input');
          await fetch('/api/comments',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({post_id:parseInt(this.dataset.post),text:input.value.trim()})});
          input.value=''; loadPosts();
        });
        container.appendChild(div);
      }
    }

    document.getElementById('sortSelect')?.addEventListener('change', ()=>loadPosts(true));
    document.getElementById('filterSelect')?.addEventListener('change', ()=>loadPosts(true));

    // Image preview
    document.getElementById('postImage')?.addEventListener('change', function(){
      const preview=document.getElementById('imagePreview');
      const img=document.getElementById('previewImg');
      if (this.files&&this.files[0]) {
        img.src=URL.createObjectURL(this.files[0]);
        preview.style.display='block';
      } else {
        preview.style.display='none';
      }
    });

    postForm.addEventListener('submit', function(e){
      e.preventDefault();
      const text=postForm.text.value.trim(); if (!text) return;
      const fd=new FormData(postForm);
      fetch('/api/posts',{method:'POST',body:fd})
        .then(()=>{
          postForm.reset();
          document.getElementById('imagePreview').style.display='none';
          loadModQueue();
        });
      alert('Your post has been submitted for review. It will appear once approved.');
    });

    loadModQueue();
    loadPosts();
  }

  // ─── Settings ──────────────────────────────────────────────────────────────
  if (document.getElementById('goalsCard')) {
    let _goals=[], _cats=[], _dotSettings={};

    async function loadSettings() {
      [_goals, _cats, _dotSettings] = await Promise.all([
        fetch('/api/goals').then(r=>r.json()),
        fetch('/api/categories').then(r=>r.json()),
        fetch('/api/dot-settings').then(r=>r.json())
      ]);
      renderGoals(); renderCats(); renderDotDefs();
      document.getElementById('datesForGreen').value = _dotSettings['dates_for_green']||'2';
      document.getElementById('inactivityDays').value = _dotSettings['inactivity_days']||'30';
    }

    // ── Goals ─────────────────────────────────────────────────────────────────
    function renderGoals() {
      const list=document.getElementById('goalsList'); list.innerHTML='';
      const PL={daily:'day',weekly:'week',monthly:'month',bimonthly:'2 months'};
      _goals.forEach(g=>{
        const valStr = g.ui_type==='toggle' ? 'toggle' : `${g.goal_value} / ${PL[g.goal_period]||g.goal_period}`;
        const row=document.createElement('div'); row.className='settings-row';
        row.innerHTML=`
          <div class="settings-icon" style="background:${g.bg_color||'#F5F5F5'};">${g.icon||'📋'}</div>
          <div class="settings-label" style="flex:1;">${escapeHtml(g.name)}</div>
          <div class="settings-sub" style="margin-right:10px;white-space:nowrap;">${valStr}</div>
          <button class="btn btn-secondary btn-sm">Edit</button>`;
        row.querySelector('button').addEventListener('click',()=>openGoalModal(g));
        list.appendChild(row);
      });
    }

    function openGoalModal(g) {
      const isNew=!g;
      document.getElementById('goalModalTitle').textContent=isNew?'New Goal':'Edit Goal';
      document.getElementById('goalEditId').value=g?.id||'';
      document.getElementById('goalEditName').value=g?.name||'';
      document.getElementById('goalEditIcon').value=g?.icon||'📋';
      document.getElementById('goalEditColor').value=g?.bg_color||'#EEF2FF';
      document.getElementById('goalEditType').value=g?.ui_type||'counter';
      document.getElementById('goalEditValue').value=g?.goal_value||1;
      document.getElementById('goalEditPeriod').value=g?.goal_period||'weekly';
      document.getElementById('goalEditDesc').value=g?.description||'';
      document.getElementById('goalCounterSection').style.display=(g?.ui_type||'counter')==='toggle'?'none':'';
      document.getElementById('goalDeleteBtn').style.display=isNew?'none':'inline-flex';
      // Populate calcat dropdown
      const sel=document.getElementById('goalEditCalCat'); sel.innerHTML='<option value="">— none —</option>';
      _cats.forEach(c=>{
        const opt=document.createElement('option'); opt.value=c.key;
        opt.textContent=`${c.emoji||''} ${c.name}`;
        if (c.key===(g?.cal_cat||'')) opt.selected=true;
        sel.appendChild(opt);
      });
      openModal('goalModal');
    }

    document.getElementById('goalEditType').addEventListener('change',function(){
      document.getElementById('goalCounterSection').style.display=this.value==='toggle'?'none':'';
    });
    document.getElementById('addGoalBtn').addEventListener('click',()=>openGoalModal(null));
    document.getElementById('resetGoalsBtn').addEventListener('click', async ()=>{
      if (!confirm('Restore all goals to the original defaults? This will replace your current goals.')) return;
      const res = await fetch('/api/goals/reset', {method:'POST'});
      const goals = await res.json();
      renderGoals(goals);
    });
    ['goalModalClose','goalCancelBtn','goalModalBackdrop'].forEach(id=>
      document.getElementById(id).addEventListener('click',()=>closeModal('goalModal'))
    );
    document.getElementById('goalSaveBtn').addEventListener('click', async ()=>{
      const id=document.getElementById('goalEditId').value;
      await fetch('/api/goals',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          id:id||undefined, name:document.getElementById('goalEditName').value.trim(),
          icon:document.getElementById('goalEditIcon').value.trim()||'📋',
          bg_color:document.getElementById('goalEditColor').value,
          ui_type:document.getElementById('goalEditType').value,
          goal_value:parseInt(document.getElementById('goalEditValue').value)||1,
          goal_period:document.getElementById('goalEditPeriod').value,
          description:document.getElementById('goalEditDesc').value,
          cal_cat:document.getElementById('goalEditCalCat').value||null,
          period_options:''
        })});
      closeModal('goalModal'); loadSettings();
    });
    document.getElementById('goalDeleteBtn').addEventListener('click', async ()=>{
      const id=document.getElementById('goalEditId').value;
      if (!id||!confirm('Delete this goal?')) return;
      await fetch(`/api/goals/${id}`,{method:'DELETE'});
      closeModal('goalModal'); loadSettings();
    });

    // ── Categories ────────────────────────────────────────────────────────────
    function renderCats() {
      const list=document.getElementById('catsList'); list.innerHTML='';
      _cats.forEach(c=>{
        const row=document.createElement('div'); row.className='settings-row';
        row.innerHTML=`
          <div style="width:20px;height:20px;border-radius:6px;background:${c.color};flex-shrink:0;"></div>
          <div class="settings-label" style="flex:1;">${c.emoji||''} ${escapeHtml(c.name)}</div>
          <span style="font-size:0.7rem;color:var(--text-muted);font-family:monospace;margin-right:10px;">${c.key}</span>
          <button class="btn btn-secondary btn-sm">Edit</button>`;
        row.querySelector('button').addEventListener('click',()=>openCatModal(c));
        list.appendChild(row);
      });
    }

    function openCatModal(c) {
      const isNew=!c;
      document.getElementById('catModalTitle').textContent=isNew?'New Category':'Edit Category';
      document.getElementById('catEditId').value=c?.id||'';
      document.getElementById('catEditName').value=c?.name||'';
      document.getElementById('catEditEmoji').value=c?.emoji||'';
      document.getElementById('catEditColor').value=c?.color||'#6B7280';
      document.getElementById('catDeleteBtn').style.display=isNew?'none':'inline-flex';
      openModal('catModal');
    }

    document.getElementById('addCatBtn').addEventListener('click',()=>openCatModal(null));
    ['catModalClose','catCancelBtn','catModalBackdrop'].forEach(id=>
      document.getElementById(id).addEventListener('click',()=>closeModal('catModal'))
    );
    document.getElementById('catSaveBtn').addEventListener('click', async ()=>{
      const id=document.getElementById('catEditId').value;
      await fetch('/api/categories',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:id||undefined,name:document.getElementById('catEditName').value.trim(),
          emoji:document.getElementById('catEditEmoji').value.trim(),
          color:document.getElementById('catEditColor').value})});
      closeModal('catModal'); loadSettings();
    });
    document.getElementById('catDeleteBtn').addEventListener('click', async ()=>{
      const id=document.getElementById('catEditId').value;
      if (!id||!confirm('Delete this category?')) return;
      await fetch(`/api/categories/${id}`,{method:'DELETE'});
      closeModal('catModal'); loadSettings();
    });

    // ── Dot rules ─────────────────────────────────────────────────────────────
    function renderDotDefs() {
      const list=document.getElementById('dotDefsList'); list.innerHTML='';
      const DOT_NAME={yellow:'Yellow',green:'Green',lightblue:'Light Blue',darkblue:'Dark Blue',purple:'Purple',gray:'Gray',red:'Red'};
      DOT_KEYS.forEach(k=>{
        const label=_dotSettings[`dot_${k}_label`]||k;
        const color=_dotSettings[`dot_${k}_color`]||'#9CA3AF';
        const row=document.createElement('div'); row.className='settings-row';
        row.innerHTML=`
          <input type="color" value="${color}" data-key="dot_${k}_color"
            style="width:34px;height:34px;border-radius:9px;border:1.5px solid var(--border);cursor:pointer;padding:2px;flex-shrink:0;"/>
          <div style="flex:1;padding:0 10px;">
            <div style="font-size:0.72rem;font-weight:600;color:var(--text-muted);margin-bottom:3px;">${DOT_NAME[k]}</div>
            <input type="text" value="${escapeHtml(label)}" data-key="dot_${k}_label"
              class="form-control w-100" style="font-size:0.83rem;padding:6px 10px;" placeholder="Label"/>
          </div>`;
        list.appendChild(row);
      });
    }

    async function saveAllDotSettings() {
      const settings={..._dotSettings,
        dates_for_green:document.getElementById('datesForGreen').value,
        inactivity_days:document.getElementById('inactivityDays').value};
      document.querySelectorAll('[data-key^="dot_"]').forEach(el=>{ settings[el.dataset.key]=el.value; });
      await fetch('/api/dot-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
      _dotSettings=settings;
      alert('Saved!');
    }

    document.getElementById('saveRulesBtn').addEventListener('click', saveAllDotSettings);
    document.getElementById('saveDotDefsBtn').addEventListener('click', saveAllDotSettings);

    // ── Google Calendar (.ics) import ─────────────────────────────────────────
    let _icalFile = null;
    let _previewEvents = [];  // full parsed list, mutated by user

    // Keyword → category key hints for auto-guessing
    const CAT_KEYWORDS = {
      study:    ['study','scripture','read','book','bom','bible','gospel','chapter'],
      class:    ['class','school','lecture','lab','course','homework','assignment','exam','test','quiz'],
      work:     ['work','shift','job','office','meeting','standup','sync','interview','training'],
      dates:    ['date','dinner','lunch','breakfast','movie','restaurant','hike','park','museum','coffee'],
      contact:  ['contact','text','call','reach','lesson','teach','discuss','chat','talk','visit'],
      meeting:  ['meeting','conference','ward','sacrament','bishopric','presidenc','council','district'],
      eating:   ['eat','lunch','dinner','breakfast','food','meal','snack','pizza','sushi','café','cafe'],
    };

    function guessCategory(title, srcCats) {
      const lower = title.toLowerCase();
      // First: try matching src_cats against app category names
      for (const sc of srcCats) {
        for (const c of _cats) {
          if (c.key === sc.toLowerCase() || c.name.toLowerCase() === sc.toLowerCase()) return c.key;
        }
      }
      // Second: keyword match against app category names
      for (const c of _cats) {
        if (lower.includes(c.key) || lower.includes(c.name.toLowerCase())) return c.key;
      }
      // Third: built-in keyword hints
      for (const [key, kws] of Object.entries(CAT_KEYWORDS)) {
        if (kws.some(kw => lower.includes(kw))) {
          // only use if user has this category
          if (_cats.find(c => c.key === key)) return key;
        }
      }
      return _cats[0]?.key || 'class';
    }

    function fmtIcalDate(s) {
      if (!s) return '';
      try {
        if (s.includes('T')) {
          const d = new Date(s);
          return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
            + ' ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
        } else {
          const [y,m,d] = s.split('-');
          return new Date(+y,+m-1,+d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        }
      } catch { return s; }
    }

    const catOptsHtml = () => _cats.map(c=>`<option value="${c.key}">${c.emoji||''} ${c.name}</option>`).join('');

    function updateSelectedCount() {
      const checked = document.querySelectorAll('#icalEventList input[type=checkbox]:checked').length;
      const total = document.querySelectorAll('#icalEventList input[type=checkbox]').length;
      const el = document.getElementById('icalSelectedCount');
      if (el) el.textContent = `${checked} of ${total} selected`;
    }

    function renderEventList() {
      const list = document.getElementById('icalEventList');
      const hideAllday = document.getElementById('icalSkipAllday')?.checked;
      const filtered = hideAllday ? _previewEvents.filter(e=>!e.is_allday) : _previewEvents;
      if (!filtered.length) {
        list.innerHTML='<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.84rem;">No events to show.</div>';
        updateSelectedCount(); return;
      }
      list.innerHTML = '';
      filtered.forEach((ev, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);';
        if (i === filtered.length-1) row.style.borderBottom = 'none';
        const dupBadge = ev.duplicate
          ? `<span style="font-size:0.62rem;background:#FEF3C7;color:#92400E;border-radius:4px;padding:1px 5px;font-weight:700;margin-left:5px;">duplicate?</span>`
          : '';
        const alldayBadge = ev.is_allday
          ? `<span style="font-size:0.62rem;background:#EEF2FF;color:var(--primary);border-radius:4px;padding:1px 5px;margin-left:5px;">all-day</span>`
          : '';
        const recurBadge = ev.recur && ev.recur !== 'none'
          ? `<span style="font-size:0.62rem;background:#F0FDF4;color:#16A34A;border-radius:4px;padding:1px 5px;margin-left:5px;">↻ ${ev.recur}</span>`
          : '';
        row.innerHTML = `
          <input type="checkbox" data-idx="${ev.idx}" ${ev.duplicate?'':'checked'} style="margin-top:3px;accent-color:var(--primary);flex-shrink:0;"/>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(ev.title)}${dupBadge}${alldayBadge}${recurBadge}
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:1px;">${fmtIcalDate(ev.start)}</div>
          </div>
          <select class="form-select" data-idx="${ev.idx}" style="font-size:0.75rem;padding:4px 6px;width:auto;flex-shrink:0;">${catOptsHtml()}</select>`;
        // Set guessed category
        const sel = row.querySelector('select');
        sel.value = ev.category;
        sel.addEventListener('change', function(){ _previewEvents.find(e=>e.idx===ev.idx).category = this.value; });
        row.querySelector('input').addEventListener('change', function(){
          _previewEvents.find(e=>e.idx===ev.idx).selected = this.checked;
          updateSelectedCount();
        });
        list.appendChild(row);
      });
      updateSelectedCount();
    }

    const icalFileInput = document.getElementById('icalFile');
    if (icalFileInput) {
      // Auto-detect browser timezone
      const tzSel = document.getElementById('icalTzOffset');
      if (tzSel) {
        const browserOffset = new Date().getTimezoneOffset();
        let best = null, bestDiff = Infinity;
        for (const opt of tzSel.options) {
          const diff = Math.abs(parseInt(opt.value) - browserOffset);
          if (diff < bestDiff) { bestDiff = diff; best = opt; }
        }
        if (best) best.selected = true;
      }

      document.getElementById('icalScanBtn')?.addEventListener('click', async ()=>{
        const file = icalFileInput.files[0];
        if (!file) { document.getElementById('icalScanStatus').textContent = 'Please choose a file first.'; return; }
        _icalFile = file;
        const scanStatus = document.getElementById('icalScanStatus');
        scanStatus.textContent = 'Reading file…'; scanStatus.style.color = 'var(--text-muted)';
        document.getElementById('icalStatus').textContent = '';
        const tzOffset = document.getElementById('icalTzOffset').value;
        const fd = new FormData(); fd.append('file', file); fd.append('tz_offset', tzOffset);
        try {
          const res = await fetch('/api/import-ical/preview', {method:'POST', body:fd});
          const data = await res.json();
          if (data.error) { scanStatus.textContent = data.error; scanStatus.style.color='#DC2626'; return; }
          scanStatus.textContent = '';
          // Attach guess + selected flag to each event
          _previewEvents = data.events.map(ev => ({
            ...ev,
            category: guessCategory(ev.title, ev.src_cats || []),
            selected: !ev.duplicate,
          }));
          const allday = _previewEvents.filter(e=>e.is_allday).length;
          const total = _previewEvents.length;
          document.getElementById('icalScanInfo').innerHTML =
            `<strong>${total}</strong> events found`
            + (data.cal_name ? ` in <em>${escapeHtml(data.cal_name)}</em>` : '')
            + (allday ? ` · ${allday} all-day` : '');
          renderEventList();
          document.getElementById('icalStep2').style.display = '';
        } catch(err) {
          scanStatus.textContent = 'Could not read file. Make sure it is a valid .ics file.';
          scanStatus.style.color = '#DC2626';
        }
      });

      document.getElementById('icalSkipAllday')?.addEventListener('change', renderEventList);
      document.getElementById('icalSelectAll')?.addEventListener('click', ()=>{
        document.querySelectorAll('#icalEventList input[type=checkbox]').forEach(cb=>{
          cb.checked=true;
          _previewEvents.find(e=>e.idx===+cb.dataset.idx && cb.dataset.idx!==undefined || false);
        });
        _previewEvents.forEach(e=>{ if(!document.getElementById('icalSkipAllday')?.checked || !e.is_allday) e.selected=true; });
        document.querySelectorAll('#icalEventList input[type=checkbox]').forEach(cb=>{ cb.checked=true; });
        updateSelectedCount();
      });
      document.getElementById('icalDeselectAll')?.addEventListener('click', ()=>{
        _previewEvents.forEach(e=>e.selected=false);
        document.querySelectorAll('#icalEventList input[type=checkbox]').forEach(cb=>{ cb.checked=false; });
        updateSelectedCount();
      });

      document.getElementById('icalCancelBtn')?.addEventListener('click', ()=>{
        icalFileInput.value = '';
        _icalFile = null; _previewEvents = [];
        document.getElementById('icalStep2').style.display = 'none';
        document.getElementById('icalScanStatus').textContent = '';
        document.getElementById('icalStatus').textContent = '';
      });

      document.getElementById('icalImportBtn')?.addEventListener('click', async ()=>{
        const toImport = _previewEvents.filter(e => e.selected !== false && (
          !document.getElementById('icalSkipAllday')?.checked || !e.is_allday
        ));
        if (!toImport.length) { alert('No events selected.'); return; }
        const statusEl = document.getElementById('icalStatus');
        statusEl.textContent = `Importing ${toImport.length} events…`; statusEl.style.color = 'var(--text-muted)';
        const fd = new FormData();
        fd.append('events_json', JSON.stringify(toImport));
        try {
          const res = await fetch('/api/import-ical', {method:'POST', body:fd});
          const data = await res.json();
          if (data.imported !== undefined) {
            statusEl.textContent = `✓ Imported ${data.imported} event${data.imported!==1?'s':''}.`;
            statusEl.style.color = '#16A34A';
            document.getElementById('icalStep2').style.display = 'none';
            icalFileInput.value = ''; _icalFile = null; _previewEvents = [];
          } else {
            statusEl.textContent = `Error: ${data.error||'Unknown error'}`;
            statusEl.style.color = '#DC2626';
          }
        } catch(err) {
          statusEl.textContent = 'Import failed.';
          statusEl.style.color = '#DC2626';
        }
      });

      document.getElementById('icalDeleteBtn')?.addEventListener('click', async ()=>{
        if (!confirm('Delete all events flagged as imported from Google Calendar? This cannot be undone.')) return;
        const statusEl = document.getElementById('icalDeleteStatus');
        statusEl.textContent = 'Deleting…'; statusEl.style.color = 'var(--text-muted)';
        try {
          const res = await fetch('/api/import-ical/delete', {method:'POST'});
          const data = await res.json();
          statusEl.textContent = `✓ Deleted ${data.deleted} imported event${data.deleted!==1?'s':''}.`;
          statusEl.style.color = '#16A34A';
        } catch(err) {
          statusEl.textContent = 'Delete failed.';
          statusEl.style.color = '#DC2626';
        }
      });

      document.getElementById('icalDeleteAllBtn')?.addEventListener('click', async ()=>{
        if (!confirm('Delete ALL your calendar events — including ones you added manually? This cannot be undone.')) return;
        if (!confirm('Are you sure? Every event will be permanently deleted.')) return;
        const statusEl = document.getElementById('icalDeleteStatus');
        statusEl.textContent = 'Deleting all events…'; statusEl.style.color = 'var(--text-muted)';
        try {
          const res = await fetch('/api/events/delete-all', {method:'POST'});
          const data = await res.json();
          statusEl.textContent = `✓ Deleted ${data.deleted} event${data.deleted!==1?'s':''}.`;
          statusEl.style.color = '#16A34A';
        } catch(err) {
          statusEl.textContent = 'Delete failed.';
          statusEl.style.color = '#DC2626';
        }
      });
    }

    loadSettings();
  }

});
