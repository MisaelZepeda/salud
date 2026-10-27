"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  const MAX_REGLAS = 3;
  const LETRAS = "ABCDEFGHIJLMNOPRSTV";
  const MODO_POR_ID = Object.fromEntries(MODOS.map((m) => [m.id, m]));
  const NOMBRE_CORTO = { reto: "Reto", yonunca: "Yo nunca", probable: "Más probable", regla: "Regla", juego: "Minijuego" };

  // localStorage puede fallar en modo privado; el juego sigue funcionando sin él.
  const guardado = {
    leer(clave, defecto) {
      try {
        const v = localStorage.getItem(clave);
        return v ? JSON.parse(v) : defecto;
      } catch {
        return defecto;
      }
    },
    escribir(clave, valor) {
      try { localStorage.setItem(clave, JSON.stringify(valor)); } catch {}
    },
  };

  const estado = {
    pantalla: "inicio",
    jugadores: guardado.leer("salud.jugadores", []),
    modos: guardado.leer("salud.modos", ["calentamiento"]).filter((id) => MODO_POR_ID[id]),
    mias: guardado.leer("salud.mias", []).filter((c) => NOMBRE_CORTO[c.tipo] && (c.modo === "todos" || MODO_POR_ID[c.modo])),
    mazo: [],
    pos: 0,
    reglas: [],
    usos: {},
    numCarta: 0,
  };

  // ---------- Utilidades ----------

  function barajar(lista) {
    const a = [...lista];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

  function formatoTiempo(seg) {
    return seg >= 60 ? `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}` : seg + " s";
  }

  function escapar(texto) {
    return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  let temporizadorAviso;
  function avisar(mensaje) {
    const el = $("#aviso");
    el.textContent = mensaje;
    el.classList.add("ver");
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => el.classList.remove("ver"), 2200);
  }

  // ---------- Navegación ----------

  function mostrar(id, { push = true } = {}) {
    estado.pantalla = id;
    document.querySelectorAll(".pantalla").forEach((p) => { p.hidden = p.id !== id; });
    if (push) history.pushState({ pantalla: id }, "", "#" + id);
    window.scrollTo(0, 0);
    if (id === "juego") {
      pedirPantallaEncendida();
    } else {
      soltarPantalla();
      pararCrono();
    }
  }

  window.addEventListener("popstate", (e) => {
    let id = e.state?.pantalla || "inicio";
    if (id === "juego" && !estado.mazo.length) id = "modos";
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    mostrar(id, { push: false });
  });

  document.querySelectorAll("[data-atras]").forEach((b) => b.addEventListener("click", () => history.back()));

  // ---------- Inicio ----------

  $("#btn-jugar").addEventListener("click", () => {
    renderJugadores();
    mostrar("jugadores");
  });
  $("#btn-como").addEventListener("click", () => $("#dlg-como").showModal());
  $("#btn-mias").addEventListener("click", () => {
    renderEditor();
    renderMias();
    mostrar("mias");
  });

  // ---------- Jugadores ----------

  function guardarJugadores() {
    guardado.escribir("salud.jugadores", estado.jugadores);
  }

  function renderJugadores() {
    const ul = $("#lista-jugadores");
    ul.replaceChildren(...estado.jugadores.map((nombre, i) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = nombre;
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.textContent = "✕";
      quitar.setAttribute("aria-label", "Quitar a " + nombre);
      quitar.addEventListener("click", () => {
        estado.jugadores.splice(i, 1);
        guardarJugadores();
        renderJugadores();
      });
      li.append(span, quitar);
      return li;
    }));

    const n = estado.jugadores.length;
    $("#btn-a-modos").disabled = n < 2;
    $("#ayuda-jugadores").textContent =
      n === 0 ? "Agrega por lo menos 2 jugadores." :
      n === 1 ? "Falta por lo menos 1 jugador más." :
      n + " jugadores. ¡Ya se armó!";
  }

  $("#form-jugador").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#input-jugador");
    const nombre = input.value.trim().replace(/\s+/g, " ").slice(0, 20);
    if (!nombre) return;
    if (estado.jugadores.some((j) => j.toLowerCase() === nombre.toLowerCase())) {
      avisar("Ese nombre ya está en la lista");
      return;
    }
    if (estado.jugadores.length >= 20) {
      avisar("Máximo 20 jugadores");
      return;
    }
    estado.jugadores.push(nombre);
    guardarJugadores();
    renderJugadores();
    input.value = "";
    input.focus();
  });

  $("#btn-a-modos").addEventListener("click", () => {
    renderModos();
    mostrar("modos");
  });

  // ---------- Modos ----------

  function renderModos() {
    const cont = $("#lista-modos");
    cont.replaceChildren(...MODOS.map((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "modo modo-" + m.id;
      b.setAttribute("aria-pressed", String(estado.modos.includes(m.id)));
      b.innerHTML = `
        <span class="modo-emoji" aria-hidden="true">${m.emoji}</span>
        <span><span class="modo-nombre">${m.nombre}</span><span class="modo-desc">${m.desc}</span></span>
        <span class="modo-check" aria-hidden="true">✓</span>`;
      b.addEventListener("click", () => alternarModo(m));
      return b;
    }));
    $("#btn-empezar").disabled = estado.modos.length === 0;
    const n = misCartasActivas().length;
    $("#ayuda-mias").textContent = n ? `⭐ Incluye ${n} ${n === 1 ? "carta tuya" : "cartas tuyas"}.` : "";
  }

  function alternarModo(m) {
    if (estado.modos.includes(m.id)) {
      estado.modos = estado.modos.filter((id) => id !== m.id);
    } else if (m.adulto) {
      const dlg = $("#dlg-picante");
      dlg.returnValue = "";
      dlg.addEventListener("close", () => {
        if (dlg.returnValue === "si") {
          estado.modos.push(m.id);
          guardado.escribir("salud.modos", estado.modos);
          renderModos();
        }
      }, { once: true });
      dlg.showModal();
      return;
    } else {
      estado.modos.push(m.id);
    }
    guardado.escribir("salud.modos", estado.modos);
    renderModos();
  }

  $("#btn-empezar").addEventListener("click", () => {
    if (!estado.modos.length) return;
    empezarPartida();
    mostrar("juego");
  });

  // ---------- Partida ----------

  function misCartasActivas() {
    return estado.mias.filter((c) => c.modo === "todos" || estado.modos.includes(c.modo));
  }

  function armarMazo() {
    const cartas = [];
    for (const modo of estado.modos) {
      for (const [tipo, lista] of Object.entries(CARTAS[modo])) {
        for (const item of lista) {
          const { texto, tiempo = 0 } = typeof item === "string" ? { texto: item } : item;
          cartas.push({ modo, tipo, texto, tiempo });
        }
      }
    }
    for (const c of misCartasActivas()) {
      cartas.push({ ...c, modo: c.modo === "todos" ? azar(estado.modos) : c.modo, mia: true });
    }
    return barajar(cartas);
  }

  function empezarPartida() {
    estado.mazo = armarMazo();
    estado.pos = 0;
    estado.reglas = [];
    estado.usos = {};
    estado.numCarta = 0;
    renderReglas();
    const nombres = estado.jugadores.map((j) => `<b class="nom">${escapar(j)}</b>`).join(", ");
    mostrarCarta({
      tipo: "inicio",
      modo: estado.modos[0],
      html: "Hoy juegan " + nombres + ".",
      instr: "Pongan el celular en medio y toquen la carta para empezar.",
      pie: estado.modos.map((id) => MODO_POR_ID[id].emoji + " " + MODO_POR_ID[id].nombre).join(" · "),
    });
  }

  function sacar() {
    if (estado.pos >= estado.mazo.length) {
      const ultima = estado.mazo[estado.mazo.length - 1];
      estado.mazo = barajar(estado.mazo);
      if (estado.mazo[0] === ultima && estado.mazo.length > 1) {
        estado.mazo.push(estado.mazo.shift());
      }
      estado.pos = 0;
    }
    return estado.mazo[estado.pos++];
  }

  // Elige jugadores distintos, dando prioridad a los que han salido menos.
  function elegir(n) {
    const orden = barajar(estado.jugadores).sort((a, b) => (estado.usos[a] || 0) - (estado.usos[b] || 0));
    const elegidos = orden.slice(0, n);
    elegidos.forEach((j) => { estado.usos[j] = (estado.usos[j] || 0) + 1; });
    return elegidos;
  }

  function rellenar(texto, modo) {
    const n = texto.includes("{p2}") ? 2 : texto.includes("{p}") ? 1 : 0;
    const [a, b] = elegir(n);
    const chip = (j) => `<b class="nom">${escapar(j)}</b>`;
    const tema = chip(azar(TEMAS[modo]));
    const letra = chip(azar([...LETRAS]));
    return escapar(texto)
      .replace(/\{p\}/g, () => chip(a))
      .replace(/\{p2\}/g, () => chip(b))
      .replace(/\{tema\}/g, () => tema)
      .replace(/\{letra\}/g, () => letra);
  }

  function siguiente() {
    pararCrono();
    estado.numCarta++;
    estado.reglas.forEach((r) => { r.restantes--; });

    const vencida = estado.reglas.findIndex((r) => r.restantes <= 0);
    if (vencida >= 0) {
      const [regla] = estado.reglas.splice(vencida, 1);
      renderReglas();
      mostrarCarta({ tipo: "fin", modo: regla.modo, mia: regla.mia, html: regla.html, instr: "Ya pueden volver a la normalidad." });
      return;
    }

    let carta;
    let intentos = 0;
    do {
      carta = sacar();
      intentos++;
    } while (carta.tipo === "regla" && estado.reglas.length >= MAX_REGLAS && intentos < 50);

    const html = rellenar(carta.texto, carta.modo);
    let instr = "";
    if (carta.tipo === "yonunca") instr = "Toma un trago quien sí lo haya hecho.";
    if (carta.tipo === "probable") instr = "A la cuenta de 3, todos señalan. El más señalado toma 2.";
    if (carta.tipo === "regla") {
      const dura = 5 + Math.floor(Math.random() * 5);
      estado.reglas.push({ html, restantes: dura, modo: carta.modo, mia: carta.mia });
      instr = `Dura ${dura} cartas. Quien la rompa, toma.`;
      renderReglas();
    }
    mostrarCarta({ tipo: carta.tipo, modo: carta.modo, mia: carta.mia, html, instr, tiempo: carta.tiempo });
  }

  function mostrarCarta({ tipo, modo, html, instr = "", pie, tiempo = 0, mia = false }) {
    const t = TIPOS[tipo];
    const m = MODO_POR_ID[modo];
    const el = $("#carta");
    el.className = "carta tipo-" + tipo;
    el.innerHTML = `
      <div class="carta-tipo"><span aria-hidden="true">${t.emoji}</span> ${t.nombre}</div>
      <div class="carta-cuerpo">
        <p class="carta-texto">${html}</p>
        <p class="carta-instr">${instr}</p>
        ${tiempo ? `<button type="button" class="crono" data-seg="${tiempo}">⏱ Iniciar ${formatoTiempo(tiempo)}</button>` : ""}
      </div>
      <div class="carta-pie">
        <span>${pie || (mia ? "⭐ Carta tuya" : m.emoji + " " + m.nombre)}</span>
        <span>${estado.numCarta ? "#" + estado.numCarta : ""}</span>
      </div>`;
    void el.offsetWidth; // reinicia la animación
    el.classList.add("entra");
  }

  function renderReglas() {
    const n = estado.reglas.length;
    $("#num-reglas").textContent = n;
    $("#btn-reglas").classList.toggle("activa", n > 0);
    $("#lista-reglas").innerHTML = n
      ? estado.reglas.map((r) => `<li>${r.html}<small>Quedan ${r.restantes} ${r.restantes === 1 ? "carta" : "cartas"}</small></li>`).join("")
      : `<li class="vacia">No hay reglas activas. Por ahora.</li>`;
  }

  $("#mesa").addEventListener("click", (e) => {
    const crono = e.target.closest(".crono");
    if (crono) iniciarCrono(crono);
    else siguiente();
  });

  // ---------- Temporizador de minijuegos ----------

  let intervalo = null;
  let audio = null;

  function pararCrono() {
    clearInterval(intervalo);
    intervalo = null;
  }

  function iniciarCrono(btn) {
    if (btn.classList.contains("corriendo")) return;
    const fin = Date.now() + Number(btn.dataset.seg) * 1000;
    btn.classList.remove("terminado");
    btn.classList.add("corriendo");
    prepararSonido();
    const pintar = () => {
      const resta = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
      btn.textContent = "⏱ " + formatoTiempo(resta);
      if (resta === 0) {
        pararCrono();
        btn.classList.remove("corriendo");
        btn.classList.add("terminado");
        btn.textContent = "⏰ ¡Tiempo! · Repetir";
        alarma();
      }
    };
    pintar();
    intervalo = setInterval(pintar, 250);
  }

  // El audio solo se puede activar después de un toque del usuario.
  function prepararSonido() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume?.();
    } catch {}
  }

  function alarma() {
    try { navigator.vibrate?.([250, 120, 250]); } catch {}
    if (!audio) return;
    [0, 0.25, 0.5].forEach((t) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const t0 = audio.currentTime + t;
      o.type = "square";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t0);
      o.stop(t0 + 0.2);
    });
  }

  document.addEventListener("keydown", (e) => {
    if (estado.pantalla !== "juego" || document.querySelector("dialog[open]")) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      siguiente();
    }
  });

  $("#btn-reglas").addEventListener("click", () => {
    renderReglas();
    $("#dlg-reglas").showModal();
  });

  $("#btn-salir").addEventListener("click", () => {
    const dlg = $("#dlg-salir");
    dlg.returnValue = "";
    dlg.addEventListener("close", () => {
      if (dlg.returnValue === "si") history.back();
    }, { once: true });
    dlg.showModal();
  });

  // ---------- Mis cartas ----------

  const EJEMPLOS = {
    reto: "Ej: {p}, cántale una de José José a {p2} o toma 2.",
    yonunca: "Ej: Yo nunca me he dormido en una peda.",
    probable: "Ej: ¿Quién es más probable que se case primero?",
    regla: "Ej: Prohibido decir «güey». Quien lo diga, toma.",
    juego: "Ej: {p} y {p2}, duelo de chistes. Quien se ría primero, toma 2.",
  };
  let tipoNuevo = "reto";

  $("#modo-carta").replaceChildren(
    new Option("Todos los niveles", "todos"),
    ...MODOS.map((m) => new Option(m.emoji + " " + m.nombre, m.id)),
  );

  function renderEditor() {
    $("#tipos-carta").replaceChildren(...Object.keys(NOMBRE_CORTO).map((id) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip tipo-" + id;
      b.setAttribute("aria-pressed", String(id === tipoNuevo));
      b.textContent = TIPOS[id].emoji + " " + NOMBRE_CORTO[id];
      b.addEventListener("click", () => {
        tipoNuevo = id;
        renderEditor();
      });
      return b;
    }));
    $("#texto-carta").placeholder = EJEMPLOS[tipoNuevo];
    $("#campo-tiempo").hidden = tipoNuevo !== "juego";
  }

  document.querySelectorAll("[data-token]").forEach((b) => b.addEventListener("click", () => {
    const ta = $("#texto-carta");
    ta.setRangeText(b.dataset.token, ta.selectionStart, ta.selectionEnd, "end");
    ta.focus();
  }));

  $("#form-carta").addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = $("#texto-carta").value.trim().replace(/\s+/g, " ").slice(0, 240);
    if (texto.length < 5) {
      avisar("Escribe la carta primero");
      return;
    }
    estado.mias.unshift({
      id: Date.now().toString(36),
      tipo: tipoNuevo,
      texto,
      modo: $("#modo-carta").value,
      tiempo: tipoNuevo === "juego" ? Number($("#tiempo-carta").value) : 0,
    });
    guardado.escribir("salud.mias", estado.mias);
    $("#texto-carta").value = "";
    renderMias();
    avisar("Carta guardada");
  });

  function vistaPrevia(texto) {
    return escapar(texto)
      .replace(/\{p\}/g, '<b class="nom">Jugador</b>')
      .replace(/\{p2\}/g, '<b class="nom">Otro jugador</b>');
  }

  function renderMias() {
    const ul = $("#lista-mias");
    $("#num-mias").textContent = estado.mias.length;
    if (!estado.mias.length) {
      ul.innerHTML = `<li class="vacia">Todavía no tienes cartas. Escribe la primera arriba.</li>`;
      return;
    }
    ul.replaceChildren(...estado.mias.map((c) => {
      const li = document.createElement("li");
      li.className = "mia tipo-" + c.tipo;
      const modo = c.modo === "todos" ? "Todos los niveles" : MODO_POR_ID[c.modo].emoji + " " + MODO_POR_ID[c.modo].nombre;
      li.innerHTML = `
        <div>
          <span class="mia-tipo">${TIPOS[c.tipo].emoji} ${NOMBRE_CORTO[c.tipo]}${c.tiempo ? " · ⏱ " + formatoTiempo(c.tiempo) : ""}</span>
          <p>${vistaPrevia(c.texto)}</p>
          <small>${modo}</small>
        </div>`;
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.textContent = "✕";
      quitar.setAttribute("aria-label", "Borrar carta");
      quitar.addEventListener("click", () => {
        estado.mias = estado.mias.filter((x) => x.id !== c.id);
        guardado.escribir("salud.mias", estado.mias);
        renderMias();
        avisar("Carta borrada");
      });
      li.append(quitar);
      return li;
    }));
  }

  // ---------- Pantalla encendida durante la partida ----------

  let candado = null;
  async function pedirPantallaEncendida() {
    try { candado = await navigator.wakeLock?.request("screen"); } catch {}
  }
  function soltarPantalla() {
    try { candado?.release(); } catch {}
    candado = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && estado.pantalla === "juego") pedirPantallaEncendida();
  });

  // ---------- Instalación ----------

  let promptInstalar = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptInstalar = e;
    $("#btn-instalar").hidden = false;
  });
  $("#btn-instalar").addEventListener("click", async () => {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    await promptInstalar.userChoice;
    promptInstalar = null;
    $("#btn-instalar").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("#btn-instalar").hidden = true; });

  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (esIOS && !instalada) $("#nota-ios").hidden = false;

  // Cuando hay una versión nueva, recarga solo si estás en la pantalla de inicio.
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const habiaVersion = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (habiaVersion && estado.pantalla === "inicio") location.reload();
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // ---------- Arranque ----------

  history.replaceState({ pantalla: "inicio" }, "", location.pathname + location.search);
  mostrar("inicio", { push: false });
})();
