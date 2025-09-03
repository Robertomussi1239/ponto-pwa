// ---- Configuração de "banco" fictício ----
// Você pode substituir por chamadas a uma API (login, horários, registro etc.)
const EMPREGADOS = {
  "01": {
    senha: "123456",
    nome: "Fulano da Silva",
    // horário fixo (24h) em Brasília (America/Sao_Paulo)
    entrada: "08:00",
    saida: "17:00"
  },
  "02": {
    senha: "abcdef",
    nome: "Maria Oliveira",
    entrada: "09:00",
    saida: "18:00"
  }
};

const TOLERANCIA_MIN = 30; // minutos após o horário fixo

// Utilidades
function getNowInSaoPauloParts(){
  // Captura componentes de data/hora em America/Sao_Paulo de forma robusta
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: parseInt(parts.hour),
    minute: parseInt(parts.minute),
    second: parseInt(parts.second),
    label: `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`
  };
}

function minutesSinceMidnight(hhmm){
  const [h, m] = hhmm.split(':').map(Number);
  return h*60 + m;
}

function nowMinutesInSaoPaulo(){
  const p = getNowInSaoPauloParts();
  return p.hour*60 + p.minute + p.second/60;
}

function todayKeySP(){
  const p = getNowInSaoPauloParts();
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}

function getJanelaValida(emp){
  const nowMin = nowMinutesInSaoPaulo();
  const ent = minutesSinceMidnight(emp.entrada);
  const sai = minutesSinceMidnight(emp.saida);

  const dentroEntrada = nowMin >= ent && nowMin <= ent + TOLERANCIA_MIN;
  const dentroSaida   = nowMin >= sai && nowMin <= sai + TOLERANCIA_MIN;

  if(dentroEntrada) return { valido: true, periodo: 'Entrada', base: emp.entrada };
  if(dentroSaida)   return { valido: true, periodo: 'Saída',   base: emp.saida   };
  // Mostrar qual o próximo ponto relevante
  const deltaEnt = nowMin - ent;
  const deltaSai = nowMin - sai;
  let proximo = (deltaEnt < 0 && Math.abs(deltaEnt) < Math.abs(deltaSai)) ? 'Entrada' : 'Saída';
  return { valido: false, periodo: proximo, base: proximo === 'Entrada' ? emp.entrada : emp.saida };
}

// Persistência local de registros (demo)
function getRegistros(){
  return JSON.parse(localStorage.getItem('registros') || '{}');
}
function setRegistros(db){
  localStorage.setItem('registros', JSON.stringify(db));
}
function jaRegistradoHoje(matricula, tipo){
  const db = getRegistros();
  const dia = todayKeySP();
  return !!(db[dia] && db[dia][matricula] && db[dia][matricula][tipo]);
}
function salvarRegistro(matricula, tipo, carimbo){
  const db = getRegistros();
  const dia = todayKeySP();
  db[dia] = db[dia] || {};
  db[dia][matricula] = db[dia][matricula] || {};
  db[dia][matricula][tipo] = carimbo;
  setRegistros(db);
}

// UI state
let usuarioAtual = null; // {matricula, nome, entrada, saida}
let timerId = null;

function $(sel){ return document.querySelector(sel); }

function init(){
  // Registro do service worker (PWA)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  // Login
  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const matricula = $('#matricula').value.trim();
    const senha = $('#senha').value.trim();

    const emp = EMPREGADOS[matricula];
    if(!emp || emp.senha !== senha){
      $('#loginErro').textContent = 'Login ou senha inválidos.';
      return;
    }

    usuarioAtual = { matricula, ...emp };
    $('#loginCard').style.display = 'none';
    $('#appCard').style.display = 'block';
    $('#nome').textContent = emp.nome;
    $('#horarioEntrada').textContent = emp.entrada;
    $('#horarioSaida').textContent   = emp.saida;
    atualizarJanela();
    iniciarRelogio();
    renderTabela();
  });

  $('#btnRegistrar').addEventListener('click', () => {
    if(!usuarioAtual) return;
    const janela = getJanelaValida(usuarioAtual);
    if(!janela.valido){
      alert('Fora do período de tolerância.');
      return;
    }
    const tipo = janela.periodo; // 'Entrada' ou 'Saída'
    if(jaRegistradoHoje(usuarioAtual.matricula, tipo)){
      alert(`${tipo} já registrada hoje.`);
      return;
    }
    const carimbo = getNowInSaoPauloParts().label + ' (BRT)';
    salvarRegistro(usuarioAtual.matricula, tipo, carimbo);
    atualizarJanela();
    renderTabela();
    alert(`${tipo} registrada com sucesso em ${carimbo}.`);
  });
}

function atualizarJanela(){
  const badge = $('#statusBadge');
  const info  = $('#statusInfo');
  const botao = $('#btnRegistrar');

  const janela = getJanelaValida(usuarioAtual);
  const tipo = janela.periodo;

  let pode = janela.valido && !jaRegistradoHoje(usuarioAtual.matricula, tipo);
  badge.className = 'badge ' + (pode ? 'ok' : 'err');
  badge.textContent = pode ? 'Período Válido' : 'Fora do Período';
  info.innerHTML = `Período atual: <strong>${tipo}</strong> • horário base <strong>${janela.base}</strong> • tolerância +${TOLERANCIA_MIN} min`;
  botao.disabled = !pode;
  botao.textContent = pode ? `Registrar ${tipo} agora` : 'Aguardando janela válida';
}

function iniciarRelogio(){
  if(timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    const parts = getNowInSaoPauloParts();
    $('#relogio').textContent = parts.label + ' BRT';
    if(usuarioAtual) atualizarJanela();
  }, 1000);
}

function renderTabela(){
  const corpo = $('#tbodyRegistros');
  corpo.innerHTML = '';
  const db = getRegistros();
  const dias = Object.keys(db).sort().reverse();
  for(const d of dias){
    const porDia = db[d][usuarioAtual.matricula];
    if(!porDia) continue;
    const entrada = porDia['Entrada'] || '-';
    const saida   = porDia['Saída'] || '-';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d}</td><td>${entrada}</td><td>${saida}</td>`;
    corpo.appendChild(tr);
  }
}

window.addEventListener('load', init);