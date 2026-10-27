"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  const MAX_REGLAS = 3;
  const LETRAS = "ABCDEFGHIJLMNOPRSTV";
  const MODO_POR_ID = Object.fromEntries(MODOS.map((m) => [m.id, m]));
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

  const sonido = (() => {
    let ctx = null;
    let activo = guardado.leer("salud.sonido", true);

    function contexto() {
      if (!activo) return null;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume();
      } catch {
        return null;
      }
      return ctx;
    }

    function tono(frec, { t = 0, dur = 0.15, tipo = "sine", vol = 0.2, hasta } = {}) {
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
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    function soplido({ t = 0, dur = 0.18, vol = 0.22, desde = 500, hasta = 2600 } = {}) {
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
      fuente.connect(filtro).connect(g).connect(c.destination);
      fuente.start(t0);
      fuente.stop(t0 + dur);
    }

    const efectos = {
      toque: () => tono(540, { dur: 0.06, tipo: "triangle", vol: 0.1 }),
      carta: () => soplido(),
      brindis: () => {
        tono(2637, { dur: 0.6, vol: 0.1 });
        tono(3951, { dur: 0.4, vol: 0.05 });
        tono(2793, { t: 0.11, dur: 0.7, vol: 0.09 });
        tono(4186, { t: 0.11, dur: 0.45, vol: 0.04 });
      },
      regla: () => {
        tono(660, { dur: 0.12, tipo: "triangle", vol: 0.16 });
        tono(990, { t: 0.1, dur: 0.22, tipo: "triangle", vol: 0.16 });
      },
      finRegla: () => {
        tono(880, { dur: 0.12, tipo: "triangle", vol: 0.14 });
        tono(587, { t: 0.1, dur: 0.25, tipo: "triangle", vol: 0.14 });
      },
      juego: () => [523, 659, 784, 1047].forEach((f, i) => tono(f, { t: i * 0.06, dur: 0.12, tipo: "square", vol: 0.05 })),
      inicioCrono: () => tono(330, { dur: 0.3, tipo: "sawtooth", vol: 0.07, hasta: 990 }),
      tic: () => tono(1250, { dur: 0.035, tipo: "square", vol: 0.05 }),
      ticFuerte: () => tono(1560, { dur: 0.08, tipo: "square", vol: 0.1 }),
      no: () => tono(170, { dur: 0.12, tipo: "square", vol: 0.07 }),
      fin: () => {
        [0, 0.17, 0.34].forEach((t) => [392, 494, 587].forEach((f) => tono(f, { t, dur: 0.14, tipo: "sawtooth", vol: 0.07 })));
        [392, 494, 587].forEach((f) => tono(f, { t: 0.52, dur: 0.6, tipo: "sawtooth", vol: 0.07, hasta: f * 1.34 }));
      },
    };

    return {
      get activo() { return activo; },
      play(nombre) {
        try { efectos[nombre]?.(); } catch {}
      },
      alternar() {
        activo = !activo;
        guardado.escribir("salud.sonido", activo);
      },
      despertar() { contexto(); },
    };
  })();

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

  // El audio solo puede arrancar después de que la persona toca la pantalla.
  document.addEventListener("pointerdown", () => sonido.despertar(), { once: true });

  // Un clic suave en todos los botones.
  document.addEventListener("click", (e) => {
    if (e.target.closest(".btn, .btn-icono, .chip, .modo, .pill, .lista-jugadores button, .lista-mias button")) {
      sonido.play("toque");
    }
  });

  // ---------- Efectos visuales ----------

  function centroDe(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Lanza emojis en todas direcciones desde un punto de la pantalla.
  function lluvia(emojis, { x = innerWidth / 2, y = innerHeight / 2, n = 14 } = {}) {
    if (SIN_MOVIMIENTO.matches) return;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "particula";
      p.textContent = azar(emojis);
      p.style.left = x + "px";
      p.style.top = y + "px";
      document.body.append(p);
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

  function renderModos(recien) {
    const cont = $("#lista-modos");
    cont.replaceChildren(...MODOS.map((m) => {
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
    }));
    $("#btn-empezar").disabled = estado.modos.length === 0;
    const n = misCartasActivas().length;
    $("#ayuda-mias").textContent = n ? `⭐ Incluye ${n} ${n === 1 ? "carta tuya" : "cartas tuyas"}.` : "";
  }

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
    pararCrono();
    estado.mazo = armarMazo();
    estado.pos = 0;
    estado.reglas = [];
    estado.usos = {};
    estado.numCarta = 0;
    renderReglas();
    const nombres = estado.jugadores.map((j) => `<b class="nom">${escapar(j)}</b>`).join(", ");
    const el = mostrarCarta({
      tipo: "inicio",
      modo: estado.modos[0],
      html: "Hoy juegan " + nombres + ".",
      instr: "Pongan el celular en medio y toquen la carta para empezar.",
      pie: estado.modos.map((id) => MODO_POR_ID[id].emoji + " " + MODO_POR_ID[id].nombre).join(" · "),
    });
    sonido.play("brindis");
    lluvia(["🥂", "🍋", "🧂", "🌵", "✨"], { ...centroDe(el), n: 18 });
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
      sonido.play("carta");
      sonido.play("finRegla");
      mostrarCarta({ tipo: "fin", modo: regla.modo, mia: regla.mia, html: `<span class="tachado">${regla.html}</span>`, instr: "Ya pueden volver a la normalidad." });
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

  // Cada carta es un elemento nuevo: la anterior sale volando y la nueva sube del mazo.
  function mostrarCarta({ tipo, modo, html, instr = "", pie, tiempo = 0, mia = false }) {
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
      </div>
      <div class="carta-pie">
        <span>${pie || (mia ? "⭐ Carta tuya" : m.emoji + " " + m.nombre)}</span>
        <span>${estado.numCarta ? "#" + estado.numCarta : ""}</span>
      </div>`;
    mesa.append(el);
    estado.ultimoCambio = Date.now();

    if (tiempo) prepararCrono(el, tiempo);
    else actualizarPista();
    return el;
  }

  let reglasAntes = 0;
  function renderReglas() {
    const n = estado.reglas.length;
    $("#num-reglas").textContent = n;
    $("#btn-reglas").classList.toggle("activa", n > 0);
    if (n > reglasAntes) reiniciarAnimacion($("#btn-reglas"), "rebota");
    reglasAntes = n;
    $("#lista-reglas").innerHTML = n
      ? estado.reglas.map((r) => `<li>${r.html}<small>Quedan ${r.restantes} ${r.restantes === 1 ? "carta" : "cartas"}</small></li>`).join("")
      : `<li class="vacia">No hay reglas activas. Por ahora.</li>`;
  }

  // En una carta con tiempo, el primer toque arranca el temporizador y la carta
  // no cambia hasta que se acaba (o hasta que tocan «Saltar»).
  function tocarMesa() {
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
      fase === "listo" ? "Toca la carta para iniciar el tiempo" :
      fase === "corriendo" ? "Esperen a que se acabe el tiempo…" :
      "Toca la carta para sacar la siguiente";
    $("#btn-saltar").hidden = fase !== "listo" && fase !== "corriendo";
  }

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
      .replace(/\{p2\}/g, '<b class="nom">Otro jugador</b>');
  }

  function renderMias(conNueva = false) {
    const ul = $("#lista-mias");
    $("#num-mias").textContent = estado.mias.length;
    if (!estado.mias.length) {
      ul.innerHTML = `<li class="vacia">Todavía no tienes cartas. Escribe la primera arriba.</li>`;
      return;
    }
    ul.replaceChildren(...estado.mias.map((c, i) => {
      const li = document.createElement("li");
      li.className = "mia tipo-" + c.tipo;
      li.classList.toggle("nuevo", conNueva && i === 0);
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

  renderSonido();
  history.replaceState({ pantalla: "inicio" }, "", location.pathname + location.search);
  mostrar("inicio", { push: false });
})();
