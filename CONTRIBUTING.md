# Contribuir a PosturePet

Gracias por el interés. Este documento explica cómo está organizado el proyecto
y qué conviene saber antes de tocar la parte delicada: la detección.

## Poner en marcha el entorno

```bash
git clone https://github.com/adriandy89/PosturePet.git
cd PosturePet
npm install        # descarga el modelo (5,8 MB) y genera el icono
npm run dev        # arranca con la consola del renderer redirigida al terminal
npm test           # 69 tests, ninguno necesita cámara
```

Requiere **Node 22 o superior** (el script de tests usa patrones glob en
`node --test`). Electron trae su propio Node, así que la versión solo afecta a
las herramientas de desarrollo.

## Cómo está repartido el código

La separación que ordena todo lo demás:

```
renderer del personaje  →  PERCEPCIÓN   cámara → landmarks → score
        ↓ IPC a 4 Hz
proceso principal       →  POLÍTICA     cuándo avisar y con qué
```

El renderer nunca decide si molestarte; el proceso principal nunca mira píxeles.
Si una función necesita las dos cosas, casi siempre está en el sitio equivocado.

### Lo que es lógica pura (y por tanto tiene tests)

| Archivo | Responsabilidad |
|---|---|
| [`src/renderer/posture.mjs`](src/renderer/posture.mjs) | Landmarks → métricas → score |
| [`src/renderer/smoothing.mjs`](src/renderer/smoothing.mjs) | EMA por métrica y ventana de gracia |
| [`src/main/policy.js`](src/main/policy.js) | Máquina de estados de los avisos |
| [`src/main/hysteresis.js`](src/main/hysteresis.js) | Umbrales de entrada y salida |
| [`src/main/profiles.js`](src/main/profiles.js) | Perfiles de calibración |

Ninguno importa Electron ni toca el DOM. Se prueban con landmarks sintéticos y
con el reloj inyectado, así que media hora de sesión simulada cuesta
microsegundos. **Si añades lógica que merezca un test, ponla aquí.**

## Antes de tocar las métricas

Tres trampas que ya costaron un rato y que están documentadas en el código:

**1. La mano de los landmarks.** MediaPipe llama "izquierdo" al hombro izquierdo
*del sujeto*, que en una imagen sin espejar aparece a la **derecha** del
encuadre (`lSh.x > rSh.x`). Generar datos de prueba al revés hace que `atan2`
devuelva valores cerca de 0 en vez de cerca de ±180, que es donde está la
discontinuidad — y entonces los tests pasan mientras la cámara real falla.

**2. Los ángulos son rectas, no vectores.** Se pliegan a `[-90, 90]` con
`lineAngleDeg()` y se restan con `angleDelta()`. Restar `atan2` a pelo cruza la
discontinuidad y produce desviaciones de decenas de grados sin que nadie se
mueva.

**3. Normalizar va después de restar.** Para una posición absoluta,
`(raw − base) / escala` es correcto; `raw/escala − base/escala` no lo es,
porque el origen del encuadre no es un punto del cuerpo. Acercarse a la cámara
desplazaba el valor un 226 % antes de arreglarlo.

Y la regla general: **la unidad de escala es la separación entre ojos**, nunca
el ancho de hombros. El ancho de hombros *es* postura, y usarlo de denominador
mete ruido postural correlacionado en todas las métricas a la vez.

### Añadir una métrica

1. Calcula la magnitud cruda en `rawFeatures()`, en unidades de `eyeWidth`.
2. Añade su desviación respecto a la base en `deviations()`.
3. Regístrala en `METRICS` con `weight`, `good`, `bad`, `dir` y `alpha`.
   **Los pesos deben sumar 1** — hay un test que lo comprueba.
4. Añade sus mensajes a `POR_METRICA` en
   [`src/main/notifier.js`](src/main/notifier.js). Otro test falla si falta.
5. Escribe un test que provoque solo ese gesto y verifique que **únicamente**
   esa métrica se mueve.

Para los umbrales, ten presente que el desplazamiento mediano entre frames de
MediaPipe es ~0,01 en coordenadas normalizadas: sobre un ancho de hombros
típico ya son ~1,5° de puro temblor del modelo, con cola hasta 4°. Un umbral
por debajo de eso marca mala postura sin que el usuario se haya movido.

## Comprobar los cambios

```bash
npm test              # lógica pura, sin cámara
npm run selftest      # cadena completa contra tu webcam, con informe
npm run dev           # y mira el panel de depuración en Ajustes
```

El **panel de depuración** de la ventana de Ajustes es la herramienta real para
ajustar detección: provoca cada gesto por separado y comprueba que solo sube la
barra que le corresponde.

Antes de abrir un PR, prueba también los falsos positivos: beber agua, girarte
a hablar con alguien, estirarte, mirar el teclado. Ninguno debería disparar un
aviso.

## Estilo

- Español sin acentos en comentarios y cadenas de código; el Markdown sí los usa.
- Sin dependencias nuevas salvo que resuelvan algo que no se pueda hacer a mano
  en menos de ~100 líneas. Ahora mismo el árbol de producción tiene **una**.
- Los comentarios explican *por qué*, no *qué*. Si un comentario describe lo que
  hace la línea de al lado, sobra.
- 2 espacios, LF, sin espacios finales (ver [`.editorconfig`](.editorconfig)).

## Licencia

Al contribuir aceptas que tu código se publique bajo la
[licencia MIT](LICENSE) del proyecto.

**No copies código de proyectos AGPL.** Los dos más parecidos a este
([batesposture](https://github.com/wtbates99/opencv2-posture-corrector) y
[pose-nudge](https://github.com/DDULDDUCK/pose-nudge)) lo son, y su copyleft se
contagiaría a todo PosturePet. Las fórmulas geométricas son ideas matemáticas y
se pueden reimplementar libremente; el código fuente no.
