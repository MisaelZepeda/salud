"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  // Iconos del sprite que está al inicio de index.html.
  const icono = (nombre) => `<svg class="ico" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;
  const MAX_REGLAS = 3;
  // Para que las reglas no se amontonen: cartas de espera entre una regla y otra,
  // cuánto dura cada una, y cartas mínimas entre dos cierres.
  const ESPERA_REGLA = [4, 9];
  const DURACION_REGLA = [6, 14];
  const ENTRE_CIERRES = 3;
  const entre = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));
  const CARTAS_POR_NIVEL = 15; // en modo progresivo sin límite de cartas
  const DURACIONES = [
    { cartas: 30, nombre: "Corta · 30" },
    { cartas: 50, nombre: "Normal · 50" },
    { cartas: 80, nombre: "Larga · 80" },
    { cartas: 0, nombre: "Sin límite" },
  ];
  const COMODINES = 2;
  const DURACION_GIRO = 3600;
  const LETRAS = "ABCDEFGHIJLMNOPRSTV";
  const MODO_POR_ID = Object.fromEntries(MODOS.map((m) => [m.id, m]));
  const ORDEN_MODOS = MODOS.map((m) => m.id);
  const NOMBRE_CORTO = { reto: "Reto", grupo: "Para todos", yonunca: "Yo nunca", probable: "Más probable", regla: "Regla", juego: "Minijuego" };
  const SIN_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)");

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
    ultimoCambio: 0,
    crono: null,
    pendientes: [],
    elegidos: {},
    progresivo: guardado.leer("salud.progresivo", false),
    limite: [30, 50, 80, 0].includes(guardado.leer("salud.limite", 50)) ? guardado.leer("salud.limite", 50) : 50,
    porNivel: CARTAS_POR_NIVEL,
    stats: {},
    festejado: guardado.leer("salud.festejado", ""),
    festejadoPartida: "",
    fases: [],
    fase: 0,
    cartasFase: 0,
    comodines: {},
    nombresCarta: [],
    tipoActual: null,
    codigoCompartir: "",
  };

  // Multipantalla: «sala» si este celular es el anfitrión, «satelite» si está viendo la partida de otro.
  const multi = {
    sala: null,
    satelite: null,
    creando: false,
    vistas: 0,
    ultimaCarta: null,
    textoSatelite: "",
    vista: { listo: false, carta: 0, giro: null, permisos: {} },
    permisos: { activo: false, sonido: true, extras: true, pasar: false, ...guardado.leer("salud.multi", {}) },
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

  const formatoReloj = (seg) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;

  function escapar(texto) {
    return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  let temporizadorAviso;
  function avisar(mensaje) {
    const el = $("#aviso");
    // Con una ventana abierta, el aviso va dentro de ella; si no, quedaría tapado.
    const contenedor = document.querySelector("dialog[open]") || document.body;
    if (el.parentNode !== contenedor) contenedor.append(el);
    el.textContent = mensaje;
    el.classList.add("ver");
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => el.classList.remove("ver"), 2200);
  }

  function vibrar(patron) {
    try { navigator.vibrate?.(patron); } catch {}
  }

  function reiniciarAnimacion(el, clase) {
    if (!el) return;
    el.classList.remove(clase);
    void el.offsetWidth;
    el.classList.add(clase);
  }

  // ---------- Sonidos ----------
  // Todos se generan en el momento con Web Audio: no hay archivos que descargar.

  const ES_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  document.documentElement.classList.toggle("ios", ES_IOS);

  const sonido = (() => {
    let ctx = null;
    let salida = null;
    let activo = guardado.leer("salud.sonido", true);
    let bloqueado = false; // un satélite sin permiso de sonido

    // En iPhone el modo silencio calla el audio web. Con la sesión "playback" (iOS 16.4+)
    // suena igual; para callarlo está el botón de sonido.
    function aplicarSesion() {
      if (!ES_IOS) return;
      try {
        if (navigator.audioSession) navigator.audioSession.type = activo ? "playback" : "auto";
      } catch {}
    }
    aplicarSesion();

    // Cierra el audio para que el siguiente toque lo vuelva a crear con la sesión nueva.
    function reiniciar() {
      try { ctx?.close(); } catch {}
      ctx = null;
      salida = null;
      document.documentElement.dataset.audio = "apagado";
    }

    // Deja ver el estado del audio en <html data-audio="..."> para diagnosticar.
    const marcar = () => { document.documentElement.dataset.audio = ctx ? ctx.state : "apagado"; };

    function contexto() {
      if (!activo) return null;
      try {
        if (!ctx) {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          // Todo pasa por un compresor: así se puede subir el volumen sin que truene la bocina.
          const compresor = ctx.createDynamicsCompressor();
          compresor.threshold.value = -14;
          compresor.knee.value = 6;
          compresor.ratio.value = 8;
          compresor.attack.value = 0.003;
          compresor.release.value = 0.2;
          compresor.connect(ctx.destination);
          salida = ctx.createGain();
          salida.gain.value = 1;
          salida.connect(compresor);
          ctx.onstatechange = marcar;
        }
        if (ctx.state !== "running") ctx.resume()?.catch?.(() => {});
      } catch {
        return null;
      }
      marcar();
      return ctx;
    }

    // iPhone solo deja sonar si el primer sonido arranca dentro de un toque.
    function desbloquear() {
      const c = contexto();
      if (!c) return;
      try {
        const fuente = c.createBufferSource();
        fuente.buffer = c.createBuffer(1, 1, 22050);
        fuente.connect(salida);
        fuente.start(0);
      } catch {}
    }

    function tono(frec, { t = 0, dur = 0.15, tipo = "sine", vol = 0.4, hasta } = {}) {
      const c = contexto();
      if (!c) return;
      const t0 = c.currentTime + t;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = tipo;
      o.frequency.setValueAtTime(frec, t0);
      if (hasta) o.frequency.exponentialRampToValueAtTime(hasta, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(salida);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    function soplido({ t = 0, dur = 0.2, vol = 0.6, desde = 700, hasta = 3200 } = {}) {
      const c = contexto();
      if (!c) return;
      const t0 = c.currentTime + t;
      const muestras = Math.floor(c.sampleRate * dur);
      const buffer = c.createBuffer(1, muestras, c.sampleRate);
      const datos = buffer.getChannelData(0);
      for (let i = 0; i < muestras; i++) datos[i] = Math.random() * 2 - 1;
      const fuente = c.createBufferSource();
      fuente.buffer = buffer;
      const filtro = c.createBiquadFilter();
      filtro.type = "bandpass";
      filtro.Q.value = 1.4;
      filtro.frequency.setValueAtTime(desde, t0);
      filtro.frequency.exponentialRampToValueAtTime(hasta, t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      fuente.connect(filtro);
      filtro.connect(g);
      g.connect(salida);
      fuente.start(t0);
      fuente.stop(t0 + dur);
    }

    // Frecuencias arriba de ~500 Hz: las bocinas de celular casi no reproducen graves.
    const efectos = {
      toque: () => tono(660, { dur: 0.07, tipo: "triangle", vol: 0.35 }),
      carta: () => soplido(),
      brindis: () => {
        tono(2637, { dur: 0.6, vol: 0.3 });
        tono(3951, { dur: 0.4, vol: 0.15 });
        tono(2793, { t: 0.11, dur: 0.7, vol: 0.26 });
        tono(4186, { t: 0.11, dur: 0.45, vol: 0.12 });
      },
      regla: () => {
        tono(660, { dur: 0.12, tipo: "triangle", vol: 0.45 });
        tono(990, { t: 0.1, dur: 0.22, tipo: "triangle", vol: 0.45 });
      },
      finRegla: () => {
        tono(880, { dur: 0.12, tipo: "triangle", vol: 0.42 });
        tono(587, { t: 0.1, dur: 0.25, tipo: "triangle", vol: 0.42 });
      },
      juego: () => [523, 659, 784, 1047].forEach((f, i) => tono(f, { t: i * 0.06, dur: 0.12, tipo: "square", vol: 0.16 })),
      inicioCrono: () => tono(440, { dur: 0.3, tipo: "sawtooth", vol: 0.22, hasta: 1320 }),
      tic: () => tono(1250, { dur: 0.04, tipo: "square", vol: 0.16 }),
      ticFuerte: () => tono(1560, { dur: 0.09, tipo: "square", vol: 0.3 }),
      no: () => tono(300, { dur: 0.14, tipo: "square", vol: 0.22, hasta: 220 }),
      fin: () => {
        [0, 0.17, 0.34].forEach((t) => [523, 659, 784].forEach((f) => tono(f, { t, dur: 0.14, tipo: "sawtooth", vol: 0.18 })));
        [523, 659, 784].forEach((f) => tono(f, { t: 0.52, dur: 0.6, tipo: "sawtooth", vol: 0.18, hasta: f * 1.34 }));
      },
      // Clics que se van espaciando, como una ruleta que frena.
      giro: (dur = 3.5) => {
        const n = 30;
        for (let k = 0; k < n; k++) tono(1700, { t: dur * Math.pow(k / n, 1.9), dur: 0.03, tipo: "square", vol: 0.14 });
      },
      nivel: () => {
        [523, 659, 784, 1047].forEach((f, i) => tono(f, { t: i * 0.08, dur: 0.14, tipo: "triangle", vol: 0.4 }));
        [1047, 1319, 1568].forEach((f) => tono(f, { t: 0.34, dur: 0.6, tipo: "triangle", vol: 0.25 }));
      },
      comodin: () => [1319, 1568, 2093, 2637].forEach((f, i) => tono(f, { t: i * 0.05, dur: 0.25, vol: 0.28 })),
    };

    return {
      get activo() { return activo; },
      get listo() { return !!ctx && ctx.state === "running"; },
      set bloqueado(valor) { bloqueado = valor; },
      play(nombre, ...args) {
        if (bloqueado) return;
        try { efectos[nombre]?.(...args); } catch {}
      },
      alternar() {
        activo = !activo;
        guardado.escribir("salud.sonido", activo);
        aplicarSesion();
        reiniciar();
      },
      desbloquear,
    };
  })();

  function renderSonido() {
    document.querySelectorAll("[data-sonido]").forEach((b) => {
      b.innerHTML = icono(sonido.activo ? "volumen" : "silencio");
      b.setAttribute("aria-label", sonido.activo ? "Silenciar sonidos" : "Activar sonidos");
    });
  }

  document.querySelectorAll("[data-sonido]").forEach((b) => b.addEventListener("click", () => {
    sonido.alternar();
    renderSonido();
  }));

  // El navegador solo deja arrancar el audio al soltar un toque (touchend/click) o con una tecla.
  // Se reintenta en cada toque hasta que el audio esté corriendo.
  const EVENTOS_DESBLOQUEO = ["touchend", "click", "keydown"];
  function desbloquearAudio() {
    sonido.desbloquear();
    if (sonido.listo) EVENTOS_DESBLOQUEO.forEach((t) => document.removeEventListener(t, desbloquearAudio, true));
  }
  EVENTOS_DESBLOQUEO.forEach((t) => document.addEventListener(t, desbloquearAudio, true));

  // Un clic suave en todos los botones.
  document.addEventListener("click", (e) => {
    if (e.target.closest(".btn, .btn-icono, .chip, .modo, .pill, .herr, .lista-jugadores button, .lista-mias button")) {
      sonido.play("toque");
    }
  });

  // ---------- Efectos visuales ----------

  function centroDe(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Lanza confeti en todas direcciones desde un punto de la pantalla.
  // Si hay una ventana abierta, va dentro de ella para que no quede tapado.
  const COLORES_CONFETI = ["--amber", "--lime", "--chile", "--agave", "--rosa", "--uva", "--oro", "--cielo"];
  function confeti({ x = innerWidth / 2, y = innerHeight / 2, n = 14 } = {}) {
    if (SIN_MOVIMIENTO.matches) return;
    const contenedor = document.querySelector("dialog[open]") || document.body;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "particula" + (Math.random() < 0.3 ? " redonda" : "");
      p.style.background = `var(${azar(COLORES_CONFETI)})`;
      p.style.left = x + "px";
      p.style.top = y + "px";
      contenedor.append(p);
      const ang = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 150;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 50;
      const giro = (Math.random() - 0.5) * 300;
      p.animate([
        { transform: "translate(-50%, -50%) scale(.3)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${giro}deg) scale(1)`, opacity: 1, offset: 0.65 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 90}px)) rotate(${giro * 1.3}deg) scale(.8)`, opacity: 0 },
      ], { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.2,.8,.3,1)" }).onfinish = () => p.remove();
    }
  }

  // Burbujas que suben en el fondo, como en un vaso de refresco.
  const burbujas = $(".burbujas");
  for (let i = 0; i < 14; i++) {
    const b = document.createElement("span");
    b.style.cssText = [
      `--x:${Math.random() * 100}%`,
      `--s:${6 + Math.random() * 18}px`,
      `--d:${9 + Math.random() * 10}s`,
      `--r:-${Math.random() * 18}s`,
      `--w:${(Math.random() - 0.5) * 60}px`,
    ].join(";");
    burbujas.append(b);
  }

  // ---------- Navegación ----------

  function mostrar(id, { push = true } = {}) {
    estado.pantalla = id;
    document.querySelectorAll(".pantalla").forEach((p) => { p.hidden = p.id !== id; });
    if (push) history.pushState({ pantalla: id }, "", "#" + id);
    window.scrollTo(0, 0);
    if (id === "juego") {
      pedirPantallaEncendida();
      emitir({ pausa: false });
    } else {
      soltarPantalla();
      pararCrono();
      if (multi.satelite) salirSatelite();
      emitir({ pausa: true });
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

  let recienAgregado = null;

  function guardarJugadores() {
    guardado.escribir("salud.jugadores", estado.jugadores);
  }

  function renderJugadores() {
    const ul = $("#lista-jugadores");
    ul.replaceChildren(...estado.jugadores.map((nombre, i) => {
      const li = document.createElement("li");
      li.classList.toggle("nuevo", nombre === recienAgregado);
      const span = document.createElement("span");
      span.textContent = nombre;
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.innerHTML = icono("x");
      quitar.setAttribute("aria-label", "Quitar a " + nombre);
      quitar.addEventListener("click", () => {
        estado.jugadores.splice(i, 1);
        guardarJugadores();
        renderJugadores();
      });
      li.append(span, quitar);
      return li;
    }));
    recienAgregado = null;

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
      sonido.play("no");
      avisar("Ese nombre ya está en la lista");
      return;
    }
    if (estado.jugadores.length >= 20) {
      sonido.play("no");
      avisar("Máximo 20 jugadores");
      return;
    }
    estado.jugadores.push(nombre);
    recienAgregado = nombre;
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

  const ordenar = (ids) => ORDEN_MODOS.filter((id) => ids.includes(id));
  const modosNucleo = () => ordenar(estado.modos.filter((id) => !MODO_POR_ID[id].tema));
  const modosTema = () => ordenar(estado.modos.filter((id) => MODO_POR_ID[id].tema));
  const nombreModo = (id) => MODO_POR_ID[id].nombre;
  // Con límite de cartas, los niveles se reparten en la partida; sin límite, se sube cada 15.
  const cartasPorNivel = (niveles) => estado.limite ? Math.max(5, Math.floor(estado.limite / niveles)) : CARTAS_POR_NIVEL;

  function botonModo(m, recien) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "modo modo-" + m.id;
    b.classList.toggle("recien", m.id === recien);
    b.setAttribute("aria-pressed", String(estado.modos.includes(m.id)));
    b.innerHTML = `
      <span class="modo-icono">${icono(m.icono)}</span>
      <span><span class="modo-nombre">${m.nombre}</span><span class="modo-desc">${m.desc}</span></span>
      <span class="modo-check">${icono("palomita")}</span>`;
    b.addEventListener("click", () => alternarModo(m));
    return b;
  }

  function renderModos(recien) {
    $("#lista-modos").replaceChildren(...MODOS.filter((m) => !m.tema).map((m) => botonModo(m, recien)));
    $("#lista-temas").replaceChildren(...MODOS.filter((m) => m.tema).map((m) => botonModo(m, recien)));
    $("#btn-empezar").disabled = estado.modos.length === 0;

    // El modo progresivo necesita al menos dos niveles normales para poder subir.
    const nucleo = modosNucleo();
    const chk = $("#chk-progresivo");
    chk.disabled = nucleo.length < 2;
    chk.checked = estado.progresivo && !chk.disabled;
    $("#op-progresivo").classList.toggle("apagado", chk.disabled);
    $("#ayuda-progresivo").textContent = chk.disabled
      ? "Elige al menos 2 niveles de arriba para usarlo."
      : `Empieza en ${nombreModo(nucleo[0])} y sube solo cada ${cartasPorNivel(nucleo.length)} cartas.` +
        (estado.limite ? "" : " Después del último nivel, todo revuelto.");

    $("#chips-duracion").replaceChildren(...DURACIONES.map((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = d.nombre;
      b.setAttribute("aria-pressed", String(d.cartas === estado.limite));
      b.addEventListener("click", () => {
        estado.limite = d.cartas;
        guardado.escribir("salud.limite", estado.limite);
        renderModos();
      });
      return b;
    }));

    const conFestejado = estado.modos.some((id) => MODO_POR_ID[id].festejado);
    $("#campo-festejado").hidden = !conFestejado;
    if (conFestejado) {
      const sel = $("#festejado");
      sel.replaceChildren(new Option("Que lo elija el juego", ""), ...estado.jugadores.map((j) => new Option(j, j)));
      sel.value = estado.jugadores.includes(estado.festejado) ? estado.festejado : "";
    }

    const n = misCartasActivas().length;
    $("#ayuda-mias").textContent = n ? `Incluye ${n} ${n === 1 ? "carta tuya" : "cartas tuyas"}.` : "";
    renderMulti();
  }

  $("#chk-progresivo").addEventListener("change", (e) => {
    estado.progresivo = e.target.checked;
    guardado.escribir("salud.progresivo", estado.progresivo);
    sonido.play("toque");
    renderModos();
  });

  $("#festejado").addEventListener("change", (e) => {
    estado.festejado = e.target.value;
    guardado.escribir("salud.festejado", estado.festejado);
  });

  function activarModo(m) {
    estado.modos.push(m.id);
    guardado.escribir("salud.modos", estado.modos);
    renderModos(m.id);
    if (m.adulto) confeti({ ...centroDe($(".modo-" + m.id)), n: 12 });
  }

  function alternarModo(m) {
    if (estado.modos.includes(m.id)) {
      estado.modos = estado.modos.filter((id) => id !== m.id);
      guardado.escribir("salud.modos", estado.modos);
      renderModos();
    } else if (m.adulto) {
      const dlg = $("#dlg-picante");
      dlg.returnValue = "";
      dlg.addEventListener("close", () => {
        if (dlg.returnValue === "si") activarModo(m);
      }, { once: true });
      dlg.showModal();
    } else {
      activarModo(m);
    }
  }

  $("#btn-empezar").addEventListener("click", () => {
    if (!estado.modos.length) return;
    mostrar("juego");
    empezarPartida();
  });

  // ---------- Partida ----------

  function misCartasActivas() {
    return estado.mias.filter((c) => c.modo === "todos" || estado.modos.includes(c.modo));
  }

  // ---------- Botella, comodines y ruleta de castigos ----------

  // Gira un elemento varias vueltas hasta que el ángulo «destino» (0 = arriba) quede arriba.
  function girar(el, desde, destino, dlg, alTerminar) {
    const actual = ((desde % 360) + 360) % 360;
    const hasta = desde + 360 * 5 + ((destino - actual + 360) % 360);
    const dur = SIN_MOVIMIENTO.matches ? 0 : DURACION_GIRO;
    void el.offsetWidth; // si la ventana se acaba de abrir, sin esto no habría animación
    el.style.transitionDuration = dur + "ms";
    el.style.transform = `rotate(${hasta}deg)`;
    if (dur) sonido.play("giro", dur / 1000);
    clearTimeout(el.temporizador);
    el.temporizador = setTimeout(() => { if (dlg.open) alTerminar(); }, dur + 60);
    return hasta;
  }

  let anguloBotella = 0;

  let ruedoJugadores = [];

  function renderRuedo(jugadores = estado.jugadores) {
    ruedoJugadores = jugadores;
    const ruedo = $("#ruedo");
    ruedo.querySelectorAll(".asiento").forEach((e) => e.remove());
    const n = jugadores.length;
    jugadores.forEach((j, i) => {
      const a = (i / n) * 2 * Math.PI;
      const s = document.createElement("span");
      s.className = "asiento";
      s.textContent = j;
      s.style.left = 50 + 41 * Math.sin(a) + "%";
      s.style.top = 50 - 41 * Math.cos(a) + "%";
      ruedo.append(s);
    });
    ruedo.classList.toggle("muchos", n > 8);
  }

  // «forzado» viene del anfitrión cuando un satélite repite su giro con el mismo resultado.
  function girarBotella(forzado) {
    const n = ruedoJugadores.length;
    const paso = 360 / n;
    const i = forzado ? forzado.i : Math.floor(Math.random() * n);
    const destino = forzado ? forzado.destino : i * paso + (Math.random() - 0.5) * paso * 0.5;
    if (!forzado) emitir({ giro: { id: Date.now(), tipo: "botella", jugadores: ruedoJugadores, i, destino }, giroAbierto: true });
    $("#ruedo").querySelectorAll(".asiento").forEach((e) => e.classList.remove("elegido"));
    $("#res-botella").textContent = "Girando…";
    $("#girar-botella").disabled = true;
    // El cuello de la botella apunta hacia arriba con 0°, así que se gira directo al ángulo del jugador.
    anguloBotella = girar($("#botella"), anguloBotella, destino, $("#dlg-botella"), () => {
      const asiento = $("#ruedo").querySelectorAll(".asiento")[i];
      asiento.classList.add("elegido");
      $("#res-botella").innerHTML = `¡Le tocó a <b class="nom-ruedo">${escapar(ruedoJugadores[i])}</b>!`;
      $("#girar-botella").disabled = false;
      sonido.play("brindis");
      vibrar(60);
      confeti({ ...centroDe(asiento), n: 12 });
      if (multi.satelite) cerrarGiroLuego();
    });
  }

  $("#btn-botella").addEventListener("click", () => {
    renderRuedo();
    $("#dlg-botella").showModal();
    girarBotella();
  });
  $("#girar-botella").addEventListener("click", () => girarBotella());

  function renderComodines() {
    const enCarta = estado.nombresCarta;
    const orden = [...estado.jugadores].sort((a, b) => enCarta.includes(b) - enCarta.includes(a));
    $("#lista-comodines").replaceChildren(...orden.map((j) => {
      const quedan = estado.comodines[j] ?? 0;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "comodin";
      b.classList.toggle("en-carta", enCarta.includes(j));
      b.disabled = quedan === 0;
      b.innerHTML = `<span class="comodin-nombre"></span><span class="comodin-cartas">${icono("comodin").repeat(quedan) || "Sin comodines"}</span>`;
      b.querySelector(".comodin-nombre").textContent = j;
      b.setAttribute("aria-label", `${j}: le quedan ${quedan}`);
      b.addEventListener("click", () => usarComodin(j));
      return b;
    }));
  }

  function usarComodin(j) {
    estado.comodines[j]--;
    estado.stats.comodines++;
    $("#dlg-comodin").close();
    const quedan = estado.comodines[j];
    sonido.play("comodin");
    avisar(`${j} se salvó de esta. ${quedan ? `Le queda ${quedan}.` : "Ya se le acabaron, a sufrir."}`);
    confeti({ ...centroDe($("#carta")), n: 10 });
    siguiente();
  }

  $("#btn-comodin").addEventListener("click", () => {
    if (["inicio", "fin", "nivel", "final"].includes(estado.tipoActual)) {
      sonido.play("no");
      avisar("En esta carta no hay de qué salvarse");
      return;
    }
    renderComodines();
    $("#dlg-comodin").showModal();
  });

  const CASTIGOS = {
    base: [
      { corto: "3 tragos", largo: "Échate 3 tragos y sin chillar, cabrón." },
      { corto: "Te salvas", largo: "¡Te salvaste! Qué pinche suerte tienes.", salva: true },
      { corto: "Canta", largo: "Canta a todo pulmón el coro que escoja el grupo. Desafina a gusto." },
      { corto: "Imita", largo: "Imita a alguien del grupo hasta que adivinen quién es." },
      { corto: "Doble", largo: "Te toca el doble de lo que decía la carta. Ni modo, te chingaste." },
      { corto: "El grupo", largo: "El grupo decide tu castigo. Que se pongan cabrones." },
    ],
    fuerte: [
      { corto: "Shot", largo: "¡Shot! Y con grito de «¡ajúa!»." },
      { corto: "Fondo", largo: "¡Fondo a tu vaso, sin respirar y sin hacer caras!" },
    ],
    picante: [
      { corto: "Prenda", largo: "Quítate una prenda. Tú escoges cuál, no te hagas." },
      { corto: "Beso", largo: "Dale un beso a quien escoja el grupo (si acepta)." },
    ],
  };
  const COLORES_RULETA = ["var(--amber)", "var(--rosa)", "var(--lime)", "var(--uva)", "var(--agave)", "var(--chile)", "var(--oro)", "var(--cielo)"];
  let segmentos = [];
  let anguloRuleta = 0;

  // Los castigos dependen de los niveles elegidos; «Te salvas» siempre sale.
  function armarRuleta(delAnfitrion) {
    if (delAnfitrion) {
      segmentos = delAnfitrion;
    } else {
      const fuerte = estado.modos.some((id) => ["fiesta", "sincontrol", "picante", "despedida"].includes(id));
      const pool = [...CASTIGOS.base, ...(fuerte ? CASTIGOS.fuerte : []), ...(estado.modos.includes("picante") ? CASTIGOS.picante : [])];
      const salva = pool.find((c) => c.salva);
      segmentos = barajar([salva, ...barajar(pool.filter((c) => !c.salva)).slice(0, 7)]);
    }
    const paso = 360 / segmentos.length;
    const rueda = $("#ruleta");
    rueda.style.background = `conic-gradient(${segmentos.map((_, i) => `${COLORES_RULETA[i % COLORES_RULETA.length]} ${i * paso}deg ${(i + 1) * paso}deg`).join(", ")})`;
    rueda.replaceChildren(...segmentos.map((c, i) => {
      const s = document.createElement("span");
      s.className = "ruleta-etq";
      s.textContent = c.corto;
      s.style.transform = `rotate(${(i + 0.5) * paso}deg)`;
      return s;
    }));
  }

  function girarRuleta(forzado) {
    const paso = 360 / segmentos.length;
    const i = forzado ? forzado.i : Math.floor(Math.random() * segmentos.length);
    // Para que el centro del segmento i quede bajo la flecha, la rueda gira 360° menos ese ángulo.
    const destino = forzado ? forzado.destino : (360 - (i + 0.5) * paso + (Math.random() - 0.5) * paso * 0.6 + 360) % 360;
    if (!forzado) emitir({ giro: { id: Date.now(), tipo: "ruleta", segmentos, i, destino }, giroAbierto: true });
    $("#res-ruleta").textContent = "Girando…";
    $("#girar-ruleta").disabled = true;
    anguloRuleta = girar($("#ruleta"), anguloRuleta, destino, $("#dlg-ruleta"), () => {
      const c = segmentos[i];
      $("#res-ruleta").textContent = c.largo;
      $("#girar-ruleta").disabled = false;
      sonido.play(c.salva ? "comodin" : "fin");
      vibrar(c.salva ? 40 : [200, 80, 200]);
      confeti({ ...centroDe($("#ruleta")), n: 14 });
      if (multi.satelite) cerrarGiroLuego();
    });
  }

  $("#btn-ruleta").addEventListener("click", () => {
    armarRuleta();
    $("#dlg-ruleta").showModal();
    girarRuleta();
  });
  $("#girar-ruleta").addEventListener("click", () => girarRuleta());

  function armarMazo(modos) {
    const cartas = [];
    for (const modo of modos) {
      for (const [tipo, lista] of Object.entries(CARTAS[modo])) {
        for (const item of lista) {
          cartas.push({ modo, tipo, tiempo: 0, ...(typeof item === "string" ? { texto: item } : item) });
        }
      }
    }
    for (const c of estado.mias.filter((c) => c.modo === "todos" || modos.includes(c.modo))) {
      cartas.push({ ...c, modo: c.modo === "todos" ? azar(modos) : c.modo, mia: true });
    }
    return barajar(cartas);
  }

  function empezarPartida() {
    pararCrono();
    // En modo progresivo, cada etapa es un nivel normal más todos los temáticos elegidos.
    const nucleo = modosNucleo();
    const temas = modosTema();
    const progresivo = estado.progresivo && nucleo.length >= 2;
    estado.fases = progresivo ? nucleo.map((id) => [id, ...temas]) : [ordenar(estado.modos)];
    estado.porNivel = cartasPorNivel(estado.fases.length);
    // Sin límite de cartas, al terminar el último nivel se revuelven todos los niveles elegidos.
    estado.mezclaFinal = progresivo && !estado.limite;
    if (estado.mezclaFinal) estado.fases.push(ordenar(estado.modos));
    estado.fase = 0;
    estado.cartasFase = 0;
    estado.stats = { reto: 0, grupo: 0, yonunca: 0, probable: 0, regla: 0, juego: 0, comodines: 0 };
    estado.pendientes = [];
    estado.reglaDesde = entre(ESPERA_REGLA);
    estado.ultimoCierre = -ENTRE_CIERRES;
    estado.mazo = armarMazo(estado.fases[0]);
    estado.pos = 0;
    estado.reglas = [];
    estado.usos = {};
    estado.numCarta = 0;
    estado.comodines = Object.fromEntries(estado.jugadores.map((j) => [j, COMODINES]));
    estado.festejadoPartida = estado.jugadores.includes(estado.festejado) ? estado.festejado : azar(estado.jugadores);
    estado.nombresCarta = [];
    renderReglas();

    const chip = (j) => `<b class="nom">${escapar(j)}</b>`;
    let html = "Hoy se ponen hasta la madre " + estado.jugadores.map(chip).join(", ") + ".";
    if (estado.modos.some((id) => MODO_POR_ID[id].festejado)) html += " Y hoy festejamos a " + chip(estado.festejadoPartida) + ".";
    let instr = "Pongan el cel en medio y toquen la carta. Quien no cumpla, toma. Aquí vale verga todo.";
    if (estado.limite) instr += ` La partida dura ${estado.limite} cartas.`;
    if (estado.fases.length > 1) instr += ` Empiezan en ${nombreModo(estado.fases[0][0])} y suben cada ${estado.porNivel} cartas.`;
    if (estado.mezclaFinal) instr += " Al final, todo revuelto.";

    const el = mostrarCarta({
      tipo: "inicio",
      modo: estado.fases[0][0],
      html,
      instr,
      pie: ordenar(estado.modos).map(nombreModo).join(" · "),
    });
    sonido.play("brindis");
    confeti({ ...centroDe(el), n: 18 });
    asegurarSala();
  }

  function subirNivel() {
    estado.fase++;
    estado.cartasFase = 0;
    estado.mazo = armarMazo(estado.fases[estado.fase]);
    estado.pos = 0;
    estado.nombresCarta = [];
    const id = estado.fases[estado.fase][0];
    const ultimo = estado.fase === estado.fases.length - 1;
    sonido.play("carta");
    sonido.play("nivel");
    vibrar([40, 60, 40]);

    if (ultimo && estado.mezclaFinal) {
      const el = mostrarCarta({
        tipo: "nivel",
        modo: id,
        html: "Ahora: todo revuelto",
        instr: "Ya pasaron por todos los niveles. De aquí en adelante salen cartas de todos, al azar.",
        pie: "Todos los niveles",
      });
      confeti({ ...centroDe(el), n: 18 });
      return;
    }

    const antesDeRevolver = estado.mezclaFinal && estado.fase === estado.fases.length - 2;
    const el = mostrarCarta({
      tipo: "nivel",
      modo: id,
      html: "Ahora: " + nombreModo(id),
      instr: ultimo ? "Último nivel. De aquí ya no se baja, cabrones."
        : antesDeRevolver ? `Último nivel. En ${estado.porNivel} cartas se revuelve todo.`
        : `Ahora sí se pone cabrón. En ${estado.porNivel} cartas vuelven a subir.`,
    });
    confeti({ ...centroDe(el), n: 16 });
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
  function elegir(n, excluir = []) {
    let candidatos = estado.jugadores.filter((j) => !excluir.includes(j));
    if (candidatos.length < n) candidatos = estado.jugadores;
    const orden = barajar(candidatos).sort((a, b) => (estado.usos[a] || 0) - (estado.usos[b] || 0));
    const elegidos = orden.slice(0, n);
    elegidos.forEach((j) => { estado.usos[j] = (estado.usos[j] || 0) + 1; });
    return elegidos;
  }

  // «fijos» reutiliza los jugadores de otra carta (continuaciones y cierres de reglas).
  function rellenar(texto, modo, fijos = {}) {
    const f = estado.festejadoPartida;
    const conFestejado = texto.includes("{f}");
    const n = texto.includes("{p2}") ? 2 : texto.includes("{p}") ? 1 : 0;
    let [a, b] = [fijos.a, fijos.b];
    if ((n >= 1 && !a) || (n === 2 && !b)) [a, b] = elegir(n, conFestejado ? [f] : []);
    estado.elegidos = { a, b };
    estado.nombresCarta = [a, b, conFestejado ? f : null].filter(Boolean);
    const chip = (j) => `<b class="nom">${escapar(j)}</b>`;
    const tema = chip(azar(TEMAS[modo]));
    const letra = chip(azar([...LETRAS]));
    return escapar(texto)
      .replace(/\{p\}/g, () => chip(a))
      .replace(/\{p2\}/g, () => chip(b))
      .replace(/\{f\}/g, () => chip(f))
      .replace(/\{tema\}/g, () => tema)
      .replace(/\{letra\}/g, () => letra);
  }

  function siguiente() {
    pararCrono();
    if (estado.limite && estado.numCarta >= estado.limite) {
      terminarPartida();
      return;
    }
    estado.numCarta++;
    estado.reglas.forEach((r) => { r.restantes--; });
    estado.pendientes.forEach((p) => { p.faltan--; });

    // Las reglas duran «hasta nuevo aviso»: el aviso es su propia carta de cierre.
    // Si dos reglas vencen juntas, la segunda espera unas cartas para no cerrar en cadena.
    const puedeCerrar = estado.numCarta - estado.ultimoCierre >= ENTRE_CIERRES;
    const vencida = puedeCerrar ? estado.reglas.findIndex((r) => r.restantes <= 0) : -1;
    if (vencida >= 0) {
      const [regla] = estado.reglas.splice(vencida, 1);
      estado.ultimoCierre = estado.numCarta;
      renderReglas();
      estado.nombresCarta = [];
      sonido.play("carta");
      sonido.play("finRegla");
      mostrarCarta(regla.fin
        ? { tipo: "fin", modo: regla.modo, mia: regla.mia, html: regla.fin, instr: `<span class="tachado">${regla.html}</span>` }
        : { tipo: "fin", modo: regla.modo, mia: regla.mia, html: `<span class="tachado">${regla.html}</span>`, instr: "Ya pueden volver a la normalidad." });
      return;
    }

    if (estado.fase < estado.fases.length - 1 && estado.cartasFase >= estado.porNivel) {
      subirNivel();
      return;
    }

    // Continuación de una carta anterior, con los mismos jugadores.
    const lista = estado.pendientes.findIndex((p) => p.faltan <= 0);
    if (lista >= 0) {
      const [p] = estado.pendientes.splice(lista, 1);
      const html = rellenar(p.texto, p.modo, p.fijos);
      sonido.play("carta");
      sonido.play("regla");
      vibrar(12);
      mostrarCarta({ tipo: p.tipo, modo: p.modo, mia: p.mia, html, instr: `<span class="origen">Viene de: ${p.origen}</span>`, continuacion: true });
      return;
    }

    let carta;
    for (let intentos = 0; ; intentos++) {
      carta = sacar();
      const bloqueada = carta.tipo === "regla" && (estado.reglas.length >= MAX_REGLAS || estado.numCarta < estado.reglaDesde);
      if (!bloqueada || intentos >= 80) break;
      // La regla que todavía no puede salir se guarda más adelante en el mazo en vez de perderse.
      estado.mazo.splice(estado.pos - 1, 1);
      estado.pos--;
      estado.mazo.splice(Math.min(estado.mazo.length, estado.pos + entre([4, 20])), 0, carta);
    }
    estado.cartasFase++;
    estado.stats[carta.tipo] = (estado.stats[carta.tipo] || 0) + 1;

    const html = rellenar(carta.texto, carta.modo);
    const fijos = { ...estado.elegidos };
    if (carta.luego) {
      estado.pendientes.push({ texto: carta.luego, origen: html, tipo: carta.tipo, modo: carta.modo, mia: carta.mia, fijos, faltan: entre([3, 6]) });
    }

    // Las cartas del juego traen el castigo en la frase; solo las de «Mis cartas» de estos tipos llevan instrucción.
    let instr = "";
    const tragos = (n) => `${n} ${n === 1 ? "trago" : "tragos"}`;
    const base = TRAGOS[carta.modo] || 2;
    if (carta.tipo === "yonunca") instr = `Quien sí lo haya hecho, se echa ${tragos(base)}.`;
    if (carta.tipo === "probable") instr = `A la de tres, todos señalan. Al más señalado le tocan ${tragos(base + 1)}.`;
    if (carta.tipo === "regla") {
      estado.reglas.push({
        html,
        fin: carta.fin ? rellenar(carta.fin, carta.modo, fijos) : "",
        restantes: entre(DURACION_REGLA),
        modo: carta.modo,
        mia: carta.mia,
        nueva: true,
      });
      if (!/nuevo aviso/i.test(carta.texto)) instr = "Hasta nuevo aviso.";
      estado.reglaDesde = estado.numCarta + entre(ESPERA_REGLA);
      renderReglas();
    }

    sonido.play("carta");
    if (carta.tipo === "regla") sonido.play("regla");
    if (carta.tipo === "juego") sonido.play("juego");
    if (carta.tipo === "grupo") sonido.play("nivel");
    vibrar(carta.tipo === "grupo" ? [30, 40, 30] : 12);

    const el = mostrarCarta({ tipo: carta.tipo, modo: carta.modo, mia: carta.mia, html, instr, tiempo: carta.tiempo });
    if (/\b(shot|shots|fondo)\b/i.test(carta.texto)) {
      sonido.play("brindis");
      confeti({ ...centroDe(el), n: 7 });
    }
  }

  function terminarPartida() {
    estado.reglas = [];
    estado.pendientes = [];
    renderReglas();
    estado.nombresCarta = [];
    const s = estado.stats;
    const dato = (num, txt) => `<div><b>${num}</b><span>${txt}</span></div>`;
    const el = mostrarCarta({
      tipo: "final",
      modo: estado.fases[estado.fase][0],
      html: "¡Se acabó la partida, cabrones!",
      instr: "Tomen agua y que nadie maneje, no sean pendejos.",
      pie: `${estado.numCarta} cartas`,
      extra: `
        <div class="final-stats">
          ${dato(s.reto + s.yonunca + s.probable, "retos")}
          ${dato(s.grupo, "para todos")}
          ${dato(s.juego, "minijuegos")}
          ${dato(s.regla, "reglas")}
          ${dato(s.comodines, "comodines")}
        </div>
        <div class="final-botones">
          <button type="button" class="btn final-otra">${icono("repetir")} Otra ronda</button>
          <button type="button" class="btn btn-sec final-salir">Terminar</button>
        </div>`,
    });
    sonido.play("carta");
    sonido.play("nivel");
    sonido.play("brindis");
    vibrar([60, 80, 60]);
    confeti({ ...centroDe(el), n: 22 });
  }

  // Cada carta es un elemento nuevo: la anterior sale volando y la nueva sube del mazo.
  function mostrarCarta({ tipo, modo, html, instr = "", pie, tiempo = 0, mia = false, extra = "", continuacion = false }) {
    const t = TIPOS[tipo];
    const m = MODO_POR_ID[modo];
    const mesa = $("#mesa");

    const vieja = $("#carta");
    if (vieja && SIN_MOVIMIENTO.matches) {
      vieja.remove();
    } else if (vieja) {
      vieja.removeAttribute("id");
      vieja.setAttribute("aria-hidden", "true");
      vieja.classList.add("sale");
      vieja.addEventListener("animationend", () => vieja.remove(), { once: true });
      setTimeout(() => vieja.remove(), 700);
    }

    estado.tipoActual = tipo;
    const el = document.createElement("article");
    el.id = "carta";
    el.className = "carta tipo-" + tipo;
    el.innerHTML = `
      ${continuacion ? `<div class="carta-tipo">${icono("revancha")} La revancha</div>`
        : tipo === "reto" ? "" : `<div class="carta-tipo">${icono(t.icono)} ${t.nombre}</div>`}
      <div class="carta-cuerpo">
        <p class="carta-texto">${html}</p>
        <p class="carta-instr">${instr}</p>
        ${tiempo ? `
          <div class="crono">
            <span class="crono-num">${formatoReloj(tiempo)}</span>
            <span class="crono-txt">Toca la carta para iniciar el tiempo</span>
            <span class="crono-barra"><i></i></span>
          </div>` : ""}
        ${extra}
      </div>
      <div class="carta-pie">
        <span>${pie || (mia ? icono("estrella") + " Carta tuya" : icono(m.icono) + " " + m.nombre)}</span>
        <span>${tipo === "final" || !estado.numCarta ? "" : estado.limite ? `${estado.numCarta}/${estado.limite}` : "#" + estado.numCarta}</span>
      </div>`;
    mesa.append(el);
    estado.ultimoCambio = Date.now();

    if (!multi.satelite) {
      multi.ultimaCarta = { id: Date.now(), tipo, modo, html, instr, pie: pie || "", tiempo, mia, extra, continuacion };
      emitir({ carta: multi.ultimaCarta, progreso: { num: estado.numCarta, limite: estado.limite }, crono: null });
    }

    const progreso = $("#progreso");
    progreso.hidden = !estado.limite;
    if (estado.limite) progreso.firstElementChild.style.transform = `scaleX(${Math.min(1, estado.numCarta / estado.limite)})`;

    if (tiempo) prepararCrono(el, tiempo);
    else actualizarPista();
    return el;
  }

  // Las reglas activas se ven como cartitas amarillas arriba de la carta.
  function renderReglas() {
    const cont = $("#reglas-vivas");
    cont.hidden = !estado.reglas.length;
    cont.replaceChildren(...estado.reglas.map((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "regla-viva";
      b.classList.toggle("nueva", !!r.nueva);
      b.innerHTML = `<span class="regla-viva-txt">${r.html}</span>`;
      b.addEventListener("click", () => $("#dlg-reglas").showModal());
      r.nueva = false;
      return b;
    }));
    $("#lista-reglas").innerHTML = estado.reglas
      .map((r) => `<li>${r.html}<small>Hasta nuevo aviso</small></li>`)
      .join("");
    if (!multi.satelite) emitir({ reglas: estado.reglas.map((r) => r.html) });
  }

  // En una carta con tiempo, el primer toque arranca el temporizador y la carta
  // no cambia hasta que se acaba (o hasta que tocan «Saltar»).
  function tocarMesa(e) {
    if (multi.satelite) {
      pedirSiguiente();
      return;
    }
    if (estado.tipoActual === "final") {
      if (e?.target.closest(".final-otra")) empezarPartida();
      else if (e?.target.closest(".final-salir")) history.back();
      return;
    }
    if (Date.now() - estado.ultimoCambio < 300) return; // evita saltarse cartas con doble toque
    const fase = estado.crono?.fase;
    if (fase === "listo") {
      iniciarCrono();
    } else if (fase === "corriendo") {
      sonido.play("no");
      reiniciarAnimacion(estado.crono.el.querySelector(".crono"), "espera");
    } else {
      siguiente();
    }
  }

  $("#mesa").addEventListener("click", tocarMesa);

  document.addEventListener("keydown", (e) => {
    if (estado.pantalla !== "juego" || document.querySelector("dialog[open]")) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      tocarMesa();
    }
  });

  $("#btn-saltar").addEventListener("click", siguiente);

  function actualizarPista() {
    const fase = estado.crono?.fase;
    $("#pista").textContent =
      multi.satelite ? multi.textoSatelite :
      estado.tipoActual === "final" ? "¿Otra ronda?" :
      fase === "listo" ? "Toca la carta para iniciar el tiempo" :
      fase === "corriendo" ? "Esperen a que se acabe el tiempo…" :
      "Toca la carta para sacar la siguiente";
    $("#btn-saltar").hidden = !!multi.satelite || (fase !== "listo" && fase !== "corriendo");
  }

  $("#btn-salir").addEventListener("click", () => {
    if (multi.satelite) {
      history.back();
      return;
    }
    const dlg = $("#dlg-salir");
    dlg.returnValue = "";
    dlg.addEventListener("close", () => {
      if (dlg.returnValue === "si") history.back();
    }, { once: true });
    dlg.showModal();
  });

  // ---------- Temporizador de minijuegos ----------

  let intervalo = null;

  function pararCrono() {
    clearInterval(intervalo);
    intervalo = null;
    estado.crono = null;
    actualizarPista();
  }

  function prepararCrono(el, seg) {
    estado.crono = { fase: "listo", total: seg, el, ultimo: seg };
    actualizarPista();
  }

  // En un satélite, «finSala» es la hora (del servidor) en que se acaba el tiempo del anfitrión.
  function iniciarCrono(finSala) {
    const c = estado.crono;
    if (!c || c.fase !== "listo") return;
    const num = c.el.querySelector(".crono-num");
    const barra = c.el.querySelector(".crono-barra i");
    c.fase = "corriendo";
    c.fin = finSala ? Date.now() + (finSala - multi.satelite.ahora()) : Date.now() + c.total * 1000;
    if (multi.sala) emitir({ crono: { fase: "corriendo", fin: multi.sala.ahora() + c.total * 1000 } });
    c.el.classList.add("cronometrando");
    c.el.querySelector(".crono-txt").textContent = "¡Corre el tiempo!";
    sonido.play("inicioCrono");
    vibrar(30);
    actualizarPista();

    const pintar = () => {
      const faltaMs = Math.max(0, c.fin - Date.now());
      const resta = Math.ceil(faltaMs / 1000);
      barra.style.transform = `scaleX(${faltaMs / (c.total * 1000)})`;
      if (resta !== c.ultimo) {
        c.ultimo = resta;
        num.textContent = formatoReloj(resta);
        if (resta > 0 && resta <= 10) sonido.play(resta <= 3 ? "ticFuerte" : "tic");
        c.el.classList.toggle("ultimos", resta > 0 && resta <= 5);
      }
      if (resta === 0) terminarCrono();
    };
    pintar();
    intervalo = setInterval(pintar, 100);
  }

  function terminarCrono() {
    clearInterval(intervalo);
    intervalo = null;
    const c = estado.crono;
    if (!c || c.fase === "terminado") return;
    c.fase = "terminado";
    emitir({ crono: { fase: "terminado" } });
    c.el.classList.remove("cronometrando", "ultimos");
    c.el.classList.add("tiempo-fuera");
    c.el.querySelector(".crono-txt").textContent = "¡Se acabó el tiempo!";
    sonido.play("fin");
    vibrar([250, 120, 250]);
    confeti({ ...centroDe(c.el.querySelector(".crono")), n: 12 });
    actualizarPista();
  }

  // ---------- Mis cartas ----------

  const EJEMPLOS = {
    reto: "Ej: Si alguna vez te dormiste en una peda, reparte 3 tragos.",
    grupo: "Ej: Todos los que traigan tenis blancos se echan 3 tragos.",
    yonunca: "Ej: Yo nunca me he dormido en una peda.",
    probable: "Ej: ¿Quién es más probable que se case primero?",
    regla: "Ej: Prohibido decir «güey» hasta nuevo aviso. Cada uno, 2 tragos.",
    juego: "Ej: {p} y {p2}, duelo de chistes. Quien se ría primero, 3 tragos.",
  };
  let tipoNuevo = "reto";

  $("#modo-carta").replaceChildren(
    new Option("Todos los niveles", "todos"),
    ...MODOS.map((m) => new Option(m.nombre, m.id)),
  );

  function renderEditor() {
    $("#tipos-carta").replaceChildren(...Object.keys(NOMBRE_CORTO).map((id) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip tipo-" + id;
      b.setAttribute("aria-pressed", String(id === tipoNuevo));
      b.innerHTML = icono(TIPOS[id].icono) + " " + NOMBRE_CORTO[id];
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
      sonido.play("no");
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
    renderMias(true);
    avisar("Carta guardada");
  });

  function vistaPrevia(texto) {
    return escapar(texto)
      .replace(/\{p\}/g, '<b class="nom">Jugador</b>')
      .replace(/\{p2\}/g, '<b class="nom">Otro jugador</b>')
      .replace(/\{f\}/g, '<b class="nom">Festejado</b>');
  }

  function itemCarta(c, alBorrar) {
    const li = document.createElement("li");
    li.className = "mia tipo-" + c.tipo;
    li.innerHTML = `
      <div>
        <span class="mia-tipo">${icono(TIPOS[c.tipo].icono)} ${NOMBRE_CORTO[c.tipo]}${c.tiempo ? " · " + icono("reloj") + " " + formatoTiempo(c.tiempo) : ""}</span>
        <p>${vistaPrevia(c.texto)}</p>
        <small>${c.modo === "todos" ? "Todos los niveles" : nombreModo(c.modo)}</small>
      </div>`;
    if (alBorrar) {
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.innerHTML = icono("x");
      quitar.setAttribute("aria-label", "Borrar carta");
      quitar.addEventListener("click", alBorrar);
      li.append(quitar);
    }
    return li;
  }

  function renderMias(conNueva = false) {
    prepararCompartir();
    const ul = $("#lista-mias");
    $("#num-mias").textContent = estado.mias.length;
    if (!estado.mias.length) {
      ul.innerHTML = `<li class="vacia">Todavía no tienes cartas. Escribe la primera arriba.</li>`;
      return;
    }
    ul.replaceChildren(...estado.mias.map((c, i) => {
      const li = itemCarta(c, () => {
        estado.mias = estado.mias.filter((x) => x.id !== c.id);
        guardado.escribir("salud.mias", estado.mias);
        renderMias();
        avisar("Carta borrada");
      });
      li.classList.toggle("nuevo", conNueva && i === 0);
      return li;
    }));
  }

  // ---------- Compartir e importar cartas ----------
  // Las cartas viajan dentro del link (#cartas=...), comprimidas cuando el navegador lo permite.
  // Nunca pasan por un servidor.

  const aBase64Url = (bytes) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const deBase64Url = (texto) => Uint8Array.from(atob(texto.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const transformar = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  async function codificarCartas(cartas) {
    const bytes = new TextEncoder().encode(JSON.stringify(cartas.map((c) => [c.tipo, c.modo, c.tiempo || 0, c.texto])));
    if ("CompressionStream" in window) {
      try { return "z" + aBase64Url(await transformar(bytes, new CompressionStream("deflate-raw"))); } catch {}
    }
    return "j" + aBase64Url(bytes);
  }

  // Todo lo que llega en un link es ajeno: se valida campo por campo.
  async function decodificarCartas(codigo) {
    let bytes = deBase64Url(codigo.slice(1));
    if (codigo[0] === "z") bytes = await transformar(bytes, new DecompressionStream("deflate-raw"));
    else if (codigo[0] !== "j") throw new Error("Código desconocido");
    const datos = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(datos)) throw new Error("Formato inválido");
    return datos.slice(0, 200).filter(Array.isArray).map(([tipo, modo, tiempo, texto]) => ({
      tipo: String(tipo),
      modo: String(modo),
      tiempo: tipo === "juego" ? Math.min(600, Math.max(0, Math.round(Number(tiempo) || 0))) : 0,
      texto: String(texto ?? "").trim().replace(/\s+/g, " ").slice(0, 240),
    })).filter((c) => NOMBRE_CORTO[c.tipo] && (c.modo === "todos" || MODO_POR_ID[c.modo]) && c.texto.length >= 5);
  }

  // El código se prepara antes del toque: compartir tiene que llamarse en el momento del toque.
  async function prepararCompartir() {
    estado.codigoCompartir = "";
    $("#btn-compartir").disabled = !estado.mias.length;
    if (!estado.mias.length) return;
    try { estado.codigoCompartir = await codificarCartas(estado.mias); } catch {}
  }

  $("#btn-compartir").addEventListener("click", async () => {
    if (!estado.codigoCompartir) {
      avisar("Escribe alguna carta primero");
      return;
    }
    const url = `${location.origin}${location.pathname}#cartas=${estado.codigoCompartir}`;
    const n = estado.mias.length;
    const texto = `Te paso ${n === 1 ? "mi carta" : `mis ${n} cartas`} para ¡Salud! Abre el link, o pégalo en «Mis cartas → Importar».`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "¡Salud!", text: texto, url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      avisar("Link copiado. Pégalo en WhatsApp.");
    } catch {
      window.prompt("Copia este link y mándalo:", url);
    }
  });

  let porImportar = [];
  let pasoImportar = "entrada";

  function abrirImportar(codigo = "") {
    porImportar = [];
    pasoImportar = "entrada";
    $("#imp-texto").value = "";
    $("#imp-entrada").hidden = false;
    $("#imp-vista").hidden = true;
    $("#imp-ok").textContent = "Revisar";
    $("#dlg-importar").showModal();
    if (codigo) revisarImportar(codigo);
  }

  const mismaCarta = (a, b) => a.tipo === b.tipo && a.modo === b.modo && a.texto === b.texto;

  async function revisarImportar(codigo) {
    let cartas = [];
    try { cartas = await decodificarCartas(codigo); } catch {}
    if (!cartas.length) {
      sonido.play("no");
      avisar("Ese link no trae cartas válidas");
      return;
    }
    porImportar = cartas.filter((c, i) => !estado.mias.some((m) => mismaCarta(m, c)) && cartas.findIndex((x) => mismaCarta(x, c)) === i);
    const repetidas = cartas.length - porImportar.length;
    pasoImportar = "vista";
    $("#imp-entrada").hidden = true;
    $("#imp-vista").hidden = false;
    $("#imp-resumen").textContent = porImportar.length
      ? `Trae ${porImportar.length} ${porImportar.length === 1 ? "carta nueva" : "cartas nuevas"}${repetidas ? ` (${repetidas} ya las tenías)` : ""}.`
      : "Ya tienes todas estas cartas.";
    $("#imp-lista").replaceChildren(...porImportar.map((c) => itemCarta(c)));
    $("#imp-ok").textContent = porImportar.length ? `Agregar ${porImportar.length}` : "Cerrar";
  }

  $("#imp-ok").addEventListener("click", () => {
    if (pasoImportar === "entrada") {
      const texto = $("#imp-texto").value;
      revisarImportar(texto.match(/#cartas=([A-Za-z0-9_-]+)/)?.[1] || texto.trim());
      return;
    }
    if (porImportar.length) {
      const base = Date.now().toString(36);
      estado.mias = [...porImportar.map((c, i) => ({ ...c, id: `${base}-${i}` })), ...estado.mias];
      guardado.escribir("salud.mias", estado.mias);
      sonido.play("comodin");
      avisar(`Se agregaron ${porImportar.length} cartas`);
      if (estado.pantalla === "mias") renderMias(true);
    }
    $("#dlg-importar").close();
  });

  $("#imp-pegar").addEventListener("click", async () => {
    try {
      $("#imp-texto").value = await navigator.clipboard.readText();
    } catch {
      avisar("Mantén presionado el cuadro y elige «Pegar»");
    }
  });

  $("#btn-importar").addEventListener("click", () => abrirImportar());

  // ---------- Multipantalla ----------
  // El anfitrión manda a la sala la carta, las reglas, el temporizador y los giros;
  // los satélites solo los muestran y, si el anfitrión lo permite, piden la siguiente carta.

  function emitir(parcial) {
    if (multi.sala) multi.sala.actualizar(parcial);
  }

  function emitirTodo() {
    emitir({
      permisos: multi.permisos,
      pausa: estado.pantalla !== "juego",
      carta: multi.ultimaCarta,
      reglas: estado.reglas.map((r) => r.html),
      progreso: { num: estado.numCarta, limite: estado.limite },
      crono: null,
      giro: null,
      giroAbierto: false,
    });
  }

  // Cuando el anfitrión cierra la botella o la ruleta, se cierra también en los satélites.
  ["#dlg-botella", "#dlg-ruleta"].forEach((d) => {
    $(d).addEventListener("close", () => { if (!multi.satelite) emitir({ giroAbierto: false }); });
  });

  // En un satélite nadie tiene que tocar «Listo»: la ventana se cierra sola poco después del resultado.
  let cierreGiro;
  function cerrarGiroLuego() {
    clearTimeout(cierreGiro);
    cierreGiro = setTimeout(cerrarGiros, 5000);
  }
  function cerrarGiros() {
    clearTimeout(cierreGiro);
    ["#dlg-botella", "#dlg-ruleta"].forEach((d) => { if ($(d).open) $(d).close(); });
  }

  function renderMulti() {
    $("#op-multi").hidden = !Multi.disponible;
    if (!Multi.disponible) return;
    $("#chk-multi").checked = multi.permisos.activo;
    $("#permisos-multi").hidden = !multi.permisos.activo;
    $("#perm-sonido").checked = multi.permisos.sonido;
    $("#perm-extras").checked = multi.permisos.extras;
    $("#perm-pasar").checked = multi.permisos.pasar;
  }

  function guardarPermisos() {
    guardado.escribir("salud.multi", multi.permisos);
    emitir({ permisos: multi.permisos });
  }

  $("#chk-multi").addEventListener("change", (e) => {
    multi.permisos.activo = e.target.checked;
    if (!multi.permisos.activo) cerrarSala();
    guardarPermisos();
    renderMulti();
  });
  [["#perm-sonido", "sonido"], ["#perm-extras", "extras"], ["#perm-pasar", "pasar"]].forEach(([selector, clave]) => {
    $(selector).addEventListener("change", (e) => {
      multi.permisos[clave] = e.target.checked;
      guardarPermisos();
    });
  });

  // Se llama al empezar cada partida: crea la sala la primera vez y después solo la actualiza.
  async function asegurarSala() {
    if (!Multi.disponible || !multi.permisos.activo || multi.satelite) return;
    if (multi.sala) {
      emitirTodo();
      return;
    }
    if (multi.creando) return;
    multi.creando = true;
    try {
      multi.sala = await Multi.crear({ permisos: multi.permisos, pausa: false });
      multi.sala.alPedir(() => {
        if (multi.permisos.pasar && estado.pantalla === "juego" && !document.querySelector("dialog[open]")) tocarMesa();
      });
      multi.sala.alContarVistas((n) => {
        multi.vistas = n;
        renderSala();
      });
      emitirTodo();
      renderSala();
      $("#dlg-sala").returnValue = "";
      $("#dlg-sala").showModal();
    } catch {
      avisar("No se pudo crear la sala. Revisa tu internet.");
    } finally {
      multi.creando = false;
    }
  }

  function cerrarSala() {
    if (!multi.sala) return;
    multi.sala.cerrar();
    multi.sala = null;
    multi.vistas = 0;
    renderSala();
  }

  function renderSala() {
    $("#btn-sala").hidden = !multi.sala;
    if (!multi.sala) return;
    $("#codigo-sala").textContent = multi.sala.codigo;
    $("#sala-vistas").textContent = multi.vistas || "";
    $("#vistas-sala").textContent = multi.vistas
      ? `${multi.vistas} ${multi.vistas === 1 ? "celular viendo" : "celulares viendo"}.`
      : "Todavía no se conecta nadie.";
  }

  const enlaceSala = () => `${location.origin}${location.pathname}${location.search}#sala=${multi.sala.codigo}`;

  $("#btn-sala").addEventListener("click", () => {
    renderSala();
    $("#dlg-sala").returnValue = "";
    $("#dlg-sala").showModal();
  });

  $("#dlg-sala").addEventListener("close", () => {
    if ($("#dlg-sala").returnValue !== "apagar") return;
    cerrarSala();
    multi.permisos.activo = false;
    guardarPermisos();
    avisar("Multipantalla apagada");
  });

  $("#btn-enviar-sala").addEventListener("click", async () => {
    const url = enlaceSala();
    if (navigator.share) {
      try {
        await navigator.share({ title: "¡Salud!", text: `Únete a la peda en ¡Salud! Código: ${multi.sala.codigo}`, url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    copiarEnlaceSala(url);
  });

  $("#btn-copiar-sala").addEventListener("click", () => copiarEnlaceSala(enlaceSala()));

  async function copiarEnlaceSala(url) {
    const boton = $("#btn-copiar-sala");
    try {
      await navigator.clipboard.writeText(url);
      boton.innerHTML = icono("palomita") + " Copiado";
      setTimeout(() => { boton.innerHTML = icono("copiar") + " Copiar"; }, 1500);
    } catch {
      window.prompt("Copia este enlace:", url);
    }
  }

  // --- Satélite ---

  $("#btn-ver").addEventListener("click", () => {
    $("#input-codigo").value = "";
    $("#dlg-unirse").showModal();
    $("#input-codigo").focus();
  });

  $("#input-codigo").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });
  $("#input-codigo").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    unirseSala(e.target.value);
  });
  $("#btn-entrar-sala").addEventListener("click", () => unirseSala($("#input-codigo").value));

  async function unirseSala(texto) {
    const codigo = String(texto).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (codigo.length !== 4) {
      sonido.play("no");
      avisar("El código es de 4 letras");
      return;
    }
    cerrarSala(); // un celular no puede ser anfitrión y satélite a la vez
    $("#btn-entrar-sala").disabled = true;
    try {
      let conexion = null;
      let pendiente;
      let hayPendiente = false;
      conexion = await Multi.unirse(codigo, (datos) => {
        if (multi.satelite && multi.satelite === conexion) {
          alCambiarSala(datos);
        } else {
          pendiente = datos;
          hayPendiente = true;
        }
      });
      if (!conexion) {
        sonido.play("no");
        avisar("No existe esa sala. Revisa el código.");
        return;
      }
      if ($("#dlg-unirse").open) $("#dlg-unirse").close();
      entrarSatelite(conexion);
      if (hayPendiente) alCambiarSala(pendiente);
    } catch {
      avisar("No se pudo conectar. Revisa tu internet.");
    } finally {
      $("#btn-entrar-sala").disabled = false;
    }
  }

  function entrarSatelite(conexion) {
    multi.satelite = conexion;
    multi.vista = { listo: false, carta: 0, giro: null, permisos: {} };
    multi.textoSatelite = `Sala ${conexion.codigo} · conectando…`;
    document.body.classList.add("modo-satelite");
    estado.reglas = [];
    estado.numCarta = 0;
    estado.limite = 0;
    $("#mesa").replaceChildren();
    renderReglas();
    mostrar("juego");
    mostrarCarta({ tipo: "inicio", modo: "calentamiento", html: "Conectando con el anfitrión…", pie: "Sala " + conexion.codigo });
  }

  function salirSatelite() {
    if (!multi.satelite) return;
    multi.satelite.salir();
    multi.satelite = null;
    document.body.classList.remove("modo-satelite");
    sonido.bloqueado = false;
    pararCrono();
    estado.reglas = [];
    estado.numCarta = 0;
    renderReglas();
    $("#mesa").replaceChildren();
    $("#progreso").hidden = true;
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  }

  let ultimoPedido = 0;
  function pedirSiguiente() {
    if (!multi.vista.permisos.pasar) {
      sonido.play("no");
      avisar("Solo el anfitrión pasa las cartas");
      return;
    }
    if (Date.now() - ultimoPedido < 700) return;
    ultimoPedido = Date.now();
    multi.satelite.pedir();
    vibrar(10);
  }

  // Lo que llega de otro celular solo puede traer las etiquetas y clases que usan las cartas.
  const ETIQUETAS_OK = new Set(["B", "SPAN", "DIV", "SMALL", "BR", "I", "EM", "STRONG"]);
  const CLASES_OK = new Set(["nom", "tachado", "origen", "final-stats"]);
  const ETIQUETAS_FUERA = new Set(["BUTTON", "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "FORM", "INPUT", "TEXTAREA", "SELECT", "LINK", "META", "TEMPLATE"]);

  function limpiarHtml(html) {
    const plantilla = document.createElement("template");
    plantilla.innerHTML = typeof html === "string" ? html.slice(0, 5000) : "";
    const recorrer = (nodo) => {
      for (const hijo of [...nodo.childNodes]) {
        if (hijo.nodeType === Node.TEXT_NODE) continue;
        if (hijo.nodeType !== Node.ELEMENT_NODE) { hijo.remove(); continue; }
        if (ETIQUETAS_FUERA.has(hijo.tagName)) { hijo.remove(); continue; }
        recorrer(hijo);
        if (!ETIQUETAS_OK.has(hijo.tagName)) { hijo.replaceWith(...hijo.childNodes); continue; }
        const clases = [...hijo.classList].filter((c) => CLASES_OK.has(c));
        for (const atributo of [...hijo.attributes]) hijo.removeAttribute(atributo.name);
        if (clases.length) hijo.className = clases.join(" ");
      }
    };
    recorrer(plantilla.content);
    return plantilla.innerHTML;
  }

  const comoLista = (valor) => (Array.isArray(valor) ? valor : Object.values(valor || {}));

  function alCambiarSala(datos) {
    if (!multi.satelite) return;
    if (!datos) {
      avisar("El anfitrión cerró la sala");
      if (estado.pantalla === "juego") history.back();
      return;
    }
    const v = multi.vista;
    const permisos = datos.permisos || {};
    v.permisos = permisos;
    sonido.bloqueado = !permisos.sonido;
    const codigo = multi.satelite.codigo;
    multi.textoSatelite =
      datos.conectado === false ? `Sala ${codigo} · el anfitrión se desconectó, esperando…` :
      datos.pausa ? `Sala ${codigo} · el anfitrión está escogiendo el siguiente juego…` :
      permisos.pasar ? `Sala ${codigo} · toca la carta para pasar` :
      `Sala ${codigo} · el anfitrión pasa las cartas`;

    estado.numCarta = Math.max(0, Number(datos.progreso?.num) || 0);
    estado.limite = [30, 50, 80].includes(Number(datos.progreso?.limite)) ? Number(datos.progreso.limite) : 0;

    const reglas = comoLista(datos.reglas).slice(0, 5).map(limpiarHtml);
    if (reglas.join("|") !== estado.reglas.map((r) => r.html).join("|")) {
      estado.reglas = reglas.map((html) => ({ html, nueva: !estado.reglas.some((r) => r.html === html) }));
      renderReglas();
    }

    const c = datos.carta;
    if (c && c.id !== v.carta) {
      v.carta = c.id;
      pararCrono();
      ["#dlg-botella", "#dlg-ruleta"].forEach((d) => { if ($(d).open) $(d).close(); });
      const tipo = TIPOS[c.tipo] ? c.tipo : "reto";
      mostrarCarta({
        tipo,
        modo: MODO_POR_ID[c.modo] ? c.modo : "calentamiento",
        html: limpiarHtml(c.html),
        instr: limpiarHtml(c.instr),
        pie: escapar(String(c.pie || "")),
        tiempo: Math.min(600, Math.max(0, Math.round(Number(c.tiempo) || 0))),
        mia: !!c.mia,
        extra: limpiarHtml(c.extra),
        continuacion: !!c.continuacion,
      });
      sonido.play("carta");
      const acento = { regla: "regla", juego: "juego", grupo: "nivel", fin: "finRegla", nivel: "nivel", final: "brindis", inicio: "brindis" }[tipo];
      if (acento) sonido.play(acento);
      vibrar(12);
    } else {
      actualizarPista();
    }

    const crono = datos.crono;
    if (crono?.fase === "corriendo" && estado.crono?.fase === "listo") iniciarCrono(Number(crono.fin) || multi.satelite.ahora());
    if (crono?.fase === "terminado" && estado.crono && estado.crono.fase !== "terminado") terminarCrono();

    // Un giro que ya había pasado antes de unirse no se repite.
    if (datos.giroAbierto === false) cerrarGiros();
    const giro = datos.giro;
    if (!v.listo) {
      v.listo = true;
      v.giro = giro?.id ?? null;
    } else if (giro && giro.id !== v.giro) {
      v.giro = giro.id;
      if (permisos.extras) mostrarGiro(giro);
    }
  }

  function mostrarGiro(giro) {
    clearTimeout(cierreGiro); // un giro nuevo no se cierra por el temporizador del anterior
    const i = Number(giro.i);
    const destino = Number(giro.destino) || 0;
    if (giro.tipo === "botella") {
      const jugadores = comoLista(giro.jugadores).map(String).slice(0, 30);
      if (!jugadores.length || !(i >= 0 && i < jugadores.length)) return;
      if ($("#dlg-ruleta").open) $("#dlg-ruleta").close();
      renderRuedo(jugadores);
      if (!$("#dlg-botella").open) $("#dlg-botella").showModal();
      girarBotella({ i, destino });
    } else if (giro.tipo === "ruleta") {
      const segs = comoLista(giro.segmentos).slice(0, 12)
        .map((s) => ({ corto: String(s?.corto || ""), largo: String(s?.largo || ""), salva: !!s?.salva }));
      if (!segs.length || !(i >= 0 && i < segs.length)) return;
      if ($("#dlg-botella").open) $("#dlg-botella").close();
      armarRuleta(segs);
      if (!$("#dlg-ruleta").open) $("#dlg-ruleta").showModal();
      girarRuleta({ i, destino });
    }
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

  const instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (ES_IOS && !instalada) $("#nota-ios").hidden = false;

  // Cuando hay una versión nueva, recarga, salvo a media partida o escribiendo una carta.
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const habiaVersion = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (habiaVersion && estado.pantalla !== "juego" && estado.pantalla !== "mias") location.reload();
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // ---------- Arranque ----------

  renderSonido();
  $("#btn-ver").hidden = !Multi.disponible;
  const codigoRecibido = location.hash.startsWith("#cartas=") ? location.hash.slice("#cartas=".length) : "";
  const salaRecibida = location.hash.startsWith("#sala=") ? location.hash.slice("#sala=".length) : "";
  history.replaceState({ pantalla: "inicio" }, "", location.pathname + location.search);
  mostrar("inicio", { push: false });
  if (codigoRecibido) abrirImportar(codigoRecibido);
  if (salaRecibida) {
    if (Multi.disponible) unirseSala(salaRecibida);
    else avisar("La multipantalla todavía no está activada en este juego");
  }

  // Si el juego ya estaba abierto y pegan el link en la misma pestaña, no hay recarga.
  window.addEventListener("hashchange", () => {
    const [, tipo, codigo] = location.hash.match(/^#(cartas|sala)=(.+)$/) || [];
    if (!tipo) return;
    history.replaceState({ pantalla: estado.pantalla }, "", location.pathname + location.search + (estado.pantalla === "inicio" ? "" : "#" + estado.pantalla));
    if (tipo === "cartas") abrirImportar(codigo);
    else if (Multi.disponible) unirseSala(codigo);
  });
})();
