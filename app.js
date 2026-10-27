"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  const MAX_REGLAS = 3;
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
  const NOMBRE_CORTO = { reto: "Reto", yonunca: "Yo nunca", probable: "Más probable", regla: "Regla", juego: "Minijuego" };
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
    let ignorarSilencio = guardado.leer("salud.ignorarSilencio", true);

    // En iPhone el modo silencio calla el audio web. Con la sesión "playback" (iOS 16.4+)
    // suena igual, pero pausa la música de otras apps en ese celular; por eso es opcional.
    function aplicarSesion() {
      if (!ES_IOS) return;
      try {
        if (navigator.audioSession) navigator.audioSession.type = activo && ignorarSilencio ? "playback" : "auto";
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
      get ignorarSilencio() { return ignorarSilencio; },
      play(nombre, ...args) {
        try { efectos[nombre]?.(...args); } catch {}
      },
      alternar() {
        activo = !activo;
        guardado.escribir("salud.sonido", activo);
        aplicarSesion();
        reiniciar();
      },
      cambiarSilencio(valor) {
        ignorarSilencio = valor;
        guardado.escribir("salud.ignorarSilencio", valor);
        aplicarSesion();
        reiniciar();
      },
      desbloquear,
    };
  })();

  const chkSilencio = $("#chk-silencio");
  chkSilencio.checked = sonido.ignorarSilencio;
  chkSilencio.addEventListener("change", () => {
    sonido.cambiarSilencio(chkSilencio.checked);
    sonido.play("toque");
  });

  function renderSonido() {
    document.querySelectorAll("[data-sonido]").forEach((b) => {
      b.textContent = sonido.activo ? "🔊" : "🔇";
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

  // Lanza emojis en todas direcciones desde un punto de la pantalla.
  // Si hay una ventana abierta, van dentro de ella para que no queden tapados.
  function lluvia(emojis, { x = innerWidth / 2, y = innerHeight / 2, n = 14 } = {}) {
    if (SIN_MOVIMIENTO.matches) return;
    const contenedor = document.querySelector("dialog[open]") || document.body;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "particula";
      p.textContent = azar(emojis);
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
  const nombreModo = (id) => MODO_POR_ID[id].emoji + " " + MODO_POR_ID[id].nombre;
  // Con límite de cartas, los niveles se reparten en la partida; sin límite, se sube cada 15.
  const cartasPorNivel = (niveles) => estado.limite ? Math.max(5, Math.floor(estado.limite / niveles)) : CARTAS_POR_NIVEL;

  function botonModo(m, recien) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "modo modo-" + m.id;
    b.classList.toggle("recien", m.id === recien);
    b.setAttribute("aria-pressed", String(estado.modos.includes(m.id)));
    b.innerHTML = `
      <span class="modo-emoji" aria-hidden="true">${m.emoji}</span>
      <span><span class="modo-nombre">${m.nombre}</span><span class="modo-desc">${m.desc}</span></span>
      <span class="modo-check" aria-hidden="true">✓</span>`;
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
      : `Empieza en ${nombreModo(nucleo[0])} y sube solo cada ${cartasPorNivel(nucleo.length)} cartas.`;

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
    $("#ayuda-mias").textContent = n ? `⭐ Incluye ${n} ${n === 1 ? "carta tuya" : "cartas tuyas"}.` : "";
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
    if (m.adulto) lluvia(["🌶️", "🔥", "💋"], { ...centroDe($(".modo-" + m.id)), n: 12 });
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

  function renderRuedo() {
    const ruedo = $("#ruedo");
    ruedo.querySelectorAll(".asiento").forEach((e) => e.remove());
    const n = estado.jugadores.length;
    estado.jugadores.forEach((j, i) => {
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

  function girarBotella() {
    const n = estado.jugadores.length;
    const i = Math.floor(Math.random() * n);
    const paso = 360 / n;
    const destino = i * paso + (Math.random() - 0.5) * paso * 0.5;
    $("#ruedo").querySelectorAll(".asiento").forEach((e) => e.classList.remove("elegido"));
    $("#res-botella").textContent = "Girando…";
    $("#girar-botella").disabled = true;
    // El cuello de la botella apunta hacia arriba con 0°, así que se gira directo al ángulo del jugador.
    anguloBotella = girar($("#botella"), anguloBotella, destino, $("#dlg-botella"), () => {
      const asiento = $("#ruedo").querySelectorAll(".asiento")[i];
      asiento.classList.add("elegido");
      $("#res-botella").innerHTML = `¡Le tocó a <b class="nom-ruedo">${escapar(estado.jugadores[i])}</b>!`;
      $("#girar-botella").disabled = false;
      sonido.play("brindis");
      vibrar(60);
      lluvia(["🍾", "✨", "🥂"], { ...centroDe(asiento), n: 12 });
    });
  }

  $("#btn-botella").addEventListener("click", () => {
    renderRuedo();
    $("#dlg-botella").showModal();
    girarBotella();
  });
  $("#girar-botella").addEventListener("click", girarBotella);

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
      b.innerHTML = `<span class="comodin-nombre"></span><span class="comodin-cartas">${"🃏".repeat(quedan) || "Sin comodines"}</span>`;
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
    avisar(`🃏 ${j} se salvó. ${quedan ? `Le queda ${quedan}.` : "Ya no le quedan comodines."}`);
    lluvia(["🃏", "😇"], { ...centroDe($("#carta")), n: 10 });
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
      { corto: "3 tragos", largo: "🍹 Échate 3 tragos y sin chillar." },
      { corto: "Te salvas", largo: "😇 ¡Te salvaste! Qué suerte tienes, no tomas.", salva: true },
      { corto: "Canta", largo: "🎤 Canta a todo pulmón el coro que escoja el grupo." },
      { corto: "Imita", largo: "🎭 Imita a alguien del grupo hasta que adivinen quién es." },
      { corto: "Doble", largo: "✌️ Te toca el doble de lo que decía la carta. Ni modo." },
      { corto: "El grupo", largo: "👥 El grupo decide tu castigo. Que se pongan creativos." },
    ],
    fuerte: [
      { corto: "Shot", largo: "🥃 ¡Shot! Y con grito de «¡ajúa!»." },
      { corto: "Fondo", largo: "🍺 ¡Fondo a tu vaso, sin respirar!" },
    ],
    picante: [
      { corto: "Prenda", largo: "👕 Quítate una prenda. Tú escoges cuál." },
      { corto: "Beso", largo: "💋 Dale un beso a quien escoja el grupo (si acepta)." },
    ],
  };
  const COLORES_RULETA = ["var(--amber)", "var(--rosa)", "var(--lime)", "var(--uva)", "var(--agave)", "var(--chile)", "var(--oro)", "var(--cielo)"];
  let segmentos = [];
  let anguloRuleta = 0;

  // Los castigos dependen de los niveles elegidos; «Te salvas» siempre sale.
  function armarRuleta() {
    const fuerte = estado.modos.some((id) => ["fiesta", "sincontrol", "picante", "despedida"].includes(id));
    const pool = [...CASTIGOS.base, ...(fuerte ? CASTIGOS.fuerte : []), ...(estado.modos.includes("picante") ? CASTIGOS.picante : [])];
    const salva = pool.find((c) => c.salva);
    segmentos = barajar([salva, ...barajar(pool.filter((c) => !c.salva)).slice(0, 7)]);
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

  function girarRuleta() {
    const paso = 360 / segmentos.length;
    const i = Math.floor(Math.random() * segmentos.length);
    // Para que el centro del segmento i quede bajo la flecha, la rueda gira 360° menos ese ángulo.
    const destino = (360 - (i + 0.5) * paso + (Math.random() - 0.5) * paso * 0.6 + 360) % 360;
    $("#res-ruleta").textContent = "Girando…";
    $("#girar-ruleta").disabled = true;
    anguloRuleta = girar($("#ruleta"), anguloRuleta, destino, $("#dlg-ruleta"), () => {
      const c = segmentos[i];
      $("#res-ruleta").textContent = c.largo;
      $("#girar-ruleta").disabled = false;
      sonido.play(c.salva ? "comodin" : "fin");
      vibrar(c.salva ? 40 : [200, 80, 200]);
      lluvia(c.salva ? ["😇", "✨"] : ["🔥", "💥", "🥃"], { ...centroDe($("#ruleta")), n: 14 });
    });
  }

  $("#btn-ruleta").addEventListener("click", () => {
    armarRuleta();
    $("#dlg-ruleta").showModal();
    girarRuleta();
  });
  $("#girar-ruleta").addEventListener("click", girarRuleta);

  function armarMazo(modos) {
    const cartas = [];
    for (const modo of modos) {
      for (const [tipo, lista] of Object.entries(CARTAS[modo])) {
        for (const item of lista) {
          const { texto, tiempo = 0 } = typeof item === "string" ? { texto: item } : item;
          cartas.push({ modo, tipo, texto, tiempo });
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
    estado.fases = estado.progresivo && nucleo.length >= 2
      ? nucleo.map((id) => [id, ...temas])
      : [ordenar(estado.modos)];
    estado.fase = 0;
    estado.cartasFase = 0;
    estado.porNivel = cartasPorNivel(estado.fases.length);
    estado.stats = { reto: 0, yonunca: 0, probable: 0, regla: 0, juego: 0, comodines: 0 };
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
    let html = "Hoy juegan " + estado.jugadores.map(chip).join(", ") + ".";
    if (estado.modos.some((id) => MODO_POR_ID[id].festejado)) html += " Y hoy festejamos a " + chip(estado.festejadoPartida) + ".";
    let instr = "Pongan el celular en medio y toquen la carta para empezar.";
    if (estado.limite) instr += ` La partida dura ${estado.limite} cartas.`;
    if (estado.fases.length > 1) instr += ` Empiezan en ${nombreModo(estado.fases[0][0])} y suben cada ${estado.porNivel} cartas.`;

    const el = mostrarCarta({
      tipo: "inicio",
      modo: estado.fases[0][0],
      html,
      instr,
      pie: ordenar(estado.modos).map(nombreModo).join(" · "),
    });
    sonido.play("brindis");
    lluvia(["🥂", "🍋", "🧂", "🌵", "✨"], { ...centroDe(el), n: 18 });
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
    const el = mostrarCarta({
      tipo: "nivel",
      modo: id,
      html: "Ahora: " + nombreModo(id),
      instr: ultimo ? "Es el último nivel. De aquí ya no se baja." : `En ${estado.porNivel} cartas vuelven a subir.`,
    });
    lluvia(["⬆️", "🔥", MODO_POR_ID[id].emoji], { ...centroDe(el), n: 16 });
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

  function rellenar(texto, modo) {
    const f = estado.festejadoPartida;
    const conFestejado = texto.includes("{f}");
    const n = texto.includes("{p2}") ? 2 : texto.includes("{p}") ? 1 : 0;
    const [a, b] = elegir(n, conFestejado ? [f] : []);
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

    const vencida = estado.reglas.findIndex((r) => r.restantes <= 0);
    if (vencida >= 0) {
      const [regla] = estado.reglas.splice(vencida, 1);
      renderReglas();
      estado.nombresCarta = [];
      sonido.play("carta");
      sonido.play("finRegla");
      mostrarCarta({ tipo: "fin", modo: regla.modo, mia: regla.mia, html: `<span class="tachado">${regla.html}</span>`, instr: "Ya pueden volver a la normalidad." });
      return;
    }

    renderReglas(); // actualiza lo que le queda a cada cartita

    if (estado.fase < estado.fases.length - 1 && estado.cartasFase >= estado.porNivel) {
      subirNivel();
      return;
    }

    let carta;
    let intentos = 0;
    do {
      carta = sacar();
      intentos++;
    } while (carta.tipo === "regla" && estado.reglas.length >= MAX_REGLAS && intentos < 50);
    estado.cartasFase++;
    estado.stats[carta.tipo] = (estado.stats[carta.tipo] || 0) + 1;

    const html = rellenar(carta.texto, carta.modo);
    let instr = "";
    const tragos = (n) => `${n} ${n === 1 ? "trago" : "tragos"}`;
    const base = TRAGOS[carta.modo] || 1;
    if (carta.tipo === "yonunca") instr = `Quien sí lo haya hecho, se echa ${tragos(base)}.`;
    if (carta.tipo === "probable") instr = `A la de tres, todos señalan. Al más señalado le tocan ${tragos(base + 1)}.`;
    if (carta.tipo === "regla") {
      const dura = 5 + Math.floor(Math.random() * 5);
      estado.reglas.push({ html, restantes: dura, modo: carta.modo, mia: carta.mia, nueva: true });
      instr = `Dura ${dura} cartas. Quien la rompa, toma.`;
      renderReglas();
    }

    sonido.play("carta");
    if (carta.tipo === "regla") sonido.play("regla");
    if (carta.tipo === "juego") sonido.play("juego");
    vibrar(12);

    const el = mostrarCarta({ tipo: carta.tipo, modo: carta.modo, mia: carta.mia, html, instr, tiempo: carta.tiempo });
    if (/\b(shot|shots|fondo)\b/i.test(carta.texto)) {
      sonido.play("brindis");
      lluvia(["🥃"], { ...centroDe(el), n: 7 });
    }
  }

  function terminarPartida() {
    estado.reglas = [];
    renderReglas();
    estado.nombresCarta = [];
    const s = estado.stats;
    const dato = (num, txt) => `<div><b>${num}</b><span>${txt}</span></div>`;
    const el = mostrarCarta({
      tipo: "final",
      modo: estado.fases[estado.fase][0],
      html: "¡Se acabó la partida! 🥂",
      instr: "Gracias por jugar. Tomen agua y que nadie maneje.",
      pie: `${estado.numCarta} cartas`,
      extra: `
        <div class="final-stats">
          ${dato(s.reto, "retos")}
          ${dato(s.yonunca + s.probable, "preguntas")}
          ${dato(s.juego, "minijuegos")}
          ${dato(s.regla, "reglas")}
          ${dato(s.comodines, "comodines")}
        </div>
        <div class="final-botones">
          <button type="button" class="btn final-otra">🔁 Otra ronda</button>
          <button type="button" class="btn btn-sec final-salir">Terminar</button>
        </div>`,
    });
    sonido.play("carta");
    sonido.play("nivel");
    sonido.play("brindis");
    vibrar([60, 80, 60]);
    lluvia(["🥂", "🎉", "🍋", "✨"], { ...centroDe(el), n: 22 });
  }

  // Cada carta es un elemento nuevo: la anterior sale volando y la nueva sube del mazo.
  function mostrarCarta({ tipo, modo, html, instr = "", pie, tiempo = 0, mia = false, extra = "" }) {
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
      <div class="carta-tipo"><span aria-hidden="true">${t.emoji}</span> ${t.nombre}</div>
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
        <span>${pie || (mia ? "⭐ Carta tuya" : m.emoji + " " + m.nombre)}</span>
        <span>${tipo === "final" || !estado.numCarta ? "" : estado.limite ? `${estado.numCarta}/${estado.limite}` : "#" + estado.numCarta}</span>
      </div>`;
    mesa.append(el);
    estado.ultimoCambio = Date.now();

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
      b.innerHTML = `<span class="regla-viva-txt">${r.html}</span><span class="regla-viva-cuenta" aria-label="Quedan ${r.restantes} cartas">⏳${r.restantes}</span>`;
      b.addEventListener("click", () => $("#dlg-reglas").showModal());
      r.nueva = false;
      return b;
    }));
    $("#lista-reglas").innerHTML = estado.reglas
      .map((r) => `<li>${r.html}<small>Quedan ${r.restantes} ${r.restantes === 1 ? "carta" : "cartas"}</small></li>`)
      .join("");
  }

  // En una carta con tiempo, el primer toque arranca el temporizador y la carta
  // no cambia hasta que se acaba (o hasta que tocan «Saltar»).
  function tocarMesa(e) {
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
      estado.tipoActual === "final" ? "¿Otra ronda?" :
      fase === "listo" ? "Toca la carta para iniciar el tiempo" :
      fase === "corriendo" ? "Esperen a que se acabe el tiempo…" :
      "Toca la carta para sacar la siguiente";
    $("#btn-saltar").hidden = fase !== "listo" && fase !== "corriendo";
  }

  $("#btn-salir").addEventListener("click", () => {
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

  function iniciarCrono() {
    const c = estado.crono;
    const num = c.el.querySelector(".crono-num");
    const barra = c.el.querySelector(".crono-barra i");
    c.fase = "corriendo";
    c.fin = Date.now() + c.total * 1000;
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
    c.fase = "terminado";
    c.el.classList.remove("cronometrando", "ultimos");
    c.el.classList.add("tiempo-fuera");
    c.el.querySelector(".crono-txt").textContent = "¡Se acabó el tiempo!";
    sonido.play("fin");
    vibrar([250, 120, 250]);
    lluvia(["⏰", "💥", "🔔"], { ...centroDe(c.el.querySelector(".crono")), n: 12 });
    actualizarPista();
  }

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
        <span class="mia-tipo">${TIPOS[c.tipo].emoji} ${NOMBRE_CORTO[c.tipo]}${c.tiempo ? " · ⏱ " + formatoTiempo(c.tiempo) : ""}</span>
        <p>${vistaPrevia(c.texto)}</p>
        <small>${c.modo === "todos" ? "Todos los niveles" : nombreModo(c.modo)}</small>
      </div>`;
    if (alBorrar) {
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.textContent = "✕";
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
    const texto = `Te paso ${n === 1 ? "mi carta" : `mis ${n} cartas`} para ¡Salud! 🥂 Abre el link, o pégalo en «Mis cartas → Importar».`;
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
      avisar(`⭐ Se agregaron ${porImportar.length} cartas`);
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
  const codigoRecibido = location.hash.startsWith("#cartas=") ? location.hash.slice("#cartas=".length) : "";
  history.replaceState({ pantalla: "inicio" }, "", location.pathname + location.search);
  mostrar("inicio", { push: false });
  if (codigoRecibido) abrirImportar(codigoRecibido);

  // Si el juego ya estaba abierto y pegan el link en la misma pestaña, no hay recarga.
  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#cartas=")) return;
    const codigo = location.hash.slice("#cartas=".length);
    history.replaceState({ pantalla: estado.pantalla }, "", location.pathname + location.search + (estado.pantalla === "inicio" ? "" : "#" + estado.pantalla));
    abrirImportar(codigo);
  });
})();
