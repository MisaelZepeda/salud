"use strict";

// Conexión de la multipantalla: un celular anfitrión controla la partida y los satélites la ven.
// Usa Firebase Realtime Database (configuración en firebase-config.js).
// Con «?local-multi» en la dirección usa pestañas del mismo navegador, para probar sin Firebase.
(() => {
  const VERSION_FIREBASE = "10.12.2";
  const CDN = `https://www.gstatic.com/firebasejs/${VERSION_FIREBASE}`;
  const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O para que no se confundan con 1 y 0
  const nuevoCodigo = () => Array.from({ length: 4 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join("");
  // Firebase no acepta «undefined»: lo quitamos antes de mandar.
  const limpio = (datos) => JSON.parse(JSON.stringify(datos));

  function conFirebase(config) {
    let conexion = null;

    function conectar() {
      conexion ||= (async () => {
        const [app, auth, db] = await Promise.all([
          import(`${CDN}/firebase-app.js`),
          import(`${CDN}/firebase-auth.js`),
          import(`${CDN}/firebase-database.js`),
        ]);
        const instancia = app.initializeApp(config);
        const { user } = await auth.signInAnonymously(auth.getAuth(instancia));
        const base = db.getDatabase(instancia);
        let desfase = 0;
        db.onValue(db.ref(base, ".info/serverTimeOffset"), (s) => { desfase = s.val() || 0; });
        return { db, base, uid: user.uid, ahora: () => Date.now() + desfase };
      })();
      conexion.catch(() => { conexion = null; }); // si falla, el siguiente intento vuelve a conectar
      return conexion;
    }

    return {
      async crear(datos) {
        const { db, base, uid, ahora } = await conectar();
        for (let intento = 0; intento < 8; intento++) {
          const codigo = nuevoCodigo();
          const sala = db.ref(base, "salas/" + codigo);
          const previa = await db.get(sala);
          if (previa.exists() && previa.val().host !== uid) continue;
          await db.set(sala, limpio({ ...datos, host: uid, conectado: true }));

          const apagar = [];
          const conectado = db.ref(base, `salas/${codigo}/conectado`);
          apagar.push(db.onValue(db.ref(base, ".info/connected"), (s) => {
            if (!s.val()) return;
            db.onDisconnect(conectado).set(false);
            db.set(conectado, true).catch(() => {});
          }));

          return {
            codigo,
            ahora,
            actualizar: (parcial) => db.update(sala, limpio(parcial)).catch(() => {}),
            alPedir(cb) {
              apagar.push(db.onChildAdded(db.ref(base, `salas/${codigo}/pedidos`), (s) => {
                db.remove(s.ref).catch(() => {});
                cb();
              }));
            },
            alContarVistas(cb) {
              apagar.push(db.onValue(db.ref(base, `salas/${codigo}/vistas`), (s) => cb(s.size)));
            },
            cerrar() {
              apagar.forEach((f) => f());
              db.onDisconnect(conectado).cancel().catch(() => {});
              db.remove(sala).catch(() => {});
            },
          };
        }
        throw new Error("No se pudo crear la sala");
      },

      async unirse(codigo, alCambiar) {
        const { db, base, uid, ahora } = await conectar();
        const sala = db.ref(base, "salas/" + codigo);
        if (!(await db.get(sala)).exists()) return null;
        const vista = db.ref(base, `salas/${codigo}/vistas/${uid}`);
        const apagar = [
          db.onValue(db.ref(base, ".info/connected"), (s) => {
            if (!s.val()) return;
            db.onDisconnect(vista).remove();
            db.set(vista, true).catch(() => {});
          }),
          db.onValue(sala, (s) => alCambiar(s.val())),
        ];
        return {
          codigo,
          ahora,
          pedir: () => db.push(db.ref(base, `salas/${codigo}/pedidos`), Date.now()).catch(() => {}),
          salir() {
            apagar.forEach((f) => f());
            db.remove(vista).catch(() => {});
          },
        };
      },
    };
  }

  // Misma interfaz que Firebase, pero entre pestañas del mismo navegador.
  function local() {
    const clave = (codigo) => "salud.sala." + codigo;
    return {
      async crear(datos) {
        const codigo = nuevoCodigo();
        const canal = new BroadcastChannel("salud-sala-" + codigo);
        const vistas = new Set();
        let estado = limpio({ ...datos, conectado: true });
        let alPedir = () => {};
        let alVistas = () => {};
        const difundir = () => {
          localStorage.setItem(clave(codigo), JSON.stringify(estado));
          canal.postMessage({ tipo: "estado", estado });
        };
        canal.onmessage = ({ data }) => {
          if (data.tipo === "pedido") alPedir();
          if (data.tipo === "hola") { vistas.add(data.id); alVistas(vistas.size); canal.postMessage({ tipo: "estado", estado }); }
          if (data.tipo === "adios") { vistas.delete(data.id); alVistas(vistas.size); }
        };
        difundir();
        return {
          codigo,
          ahora: () => Date.now(),
          actualizar(parcial) {
            estado = limpio({ ...estado, ...parcial });
            difundir();
          },
          alPedir(cb) { alPedir = cb; },
          alContarVistas(cb) { alVistas = cb; cb(vistas.size); },
          cerrar() {
            localStorage.removeItem(clave(codigo));
            canal.postMessage({ tipo: "estado", estado: null });
            canal.close();
          },
        };
      },

      async unirse(codigo, alCambiar) {
        const previo = localStorage.getItem(clave(codigo));
        if (!previo) return null;
        const canal = new BroadcastChannel("salud-sala-" + codigo);
        const id = Math.random().toString(36).slice(2);
        canal.onmessage = ({ data }) => { if (data.tipo === "estado") alCambiar(data.estado); };
        setTimeout(() => alCambiar(JSON.parse(previo)), 0);
        canal.postMessage({ tipo: "hola", id });
        return {
          codigo,
          ahora: () => Date.now(),
          pedir: () => canal.postMessage({ tipo: "pedido" }),
          salir() {
            canal.postMessage({ tipo: "adios", id });
            canal.close();
          },
        };
      },
    };
  }

  const enPrueba = new URLSearchParams(location.search).has("local-multi");
  const transporte = enPrueba ? local() : window.FIREBASE_CONFIG ? conFirebase(window.FIREBASE_CONFIG) : null;

  window.Multi = {
    disponible: !!transporte,
    enPrueba,
    crear: (datos) => transporte.crear(datos),
    unirse: (codigo, alCambiar) => transporte.unirse(codigo, alCambiar),
  };
})();
