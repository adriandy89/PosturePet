<!--
  Estas notas se publican tal cual en CADA release (.github/workflows/release.yml
  las lee de aquí). La sección «Novedades» hay que reescribirla al preparar la
  versión; el resto es evergreen y no se toca.
-->

**Monitor de postura local con webcam para Windows.** Te avisa cuando llevas
rato encorvado o con la cabeza adelantada. Todo el procesamiento ocurre en tu
máquina: ni nube, ni cuentas, ni telemetría, y la imagen de la cámara no se
guarda ni se transmite nunca.

## Novedades

**La app habla inglés y español.** Se cambia en Ajustes → Sistema, al momento y
sin reiniciar. Por defecto sigue al idioma de Windows.

**Calibrar ya no es a ciegas.** Ahora ves tu webcam en vivo con el esqueleto que
el detector reconoce dibujado encima, y una cuenta atrás 3-2-1 que **espera a
que la cámara te vea bien** antes de empezar: te veo, hombros dentro del
encuadre, cara de frente, distancia correcta. Si te giras a mitad de la cuenta,
se para en vez de fijar una postura que no ibas a mantener. Se puede cancelar,
avisa si te moviste demasiado, y hay un «Deshacer» si la nueva calibración sale
peor que la anterior.

**Los ajustes están en pestañas** en vez de una sola página con scroll
interminable, y ahora se puede tocar el doble de cosas: el sonido del aviso
(volumen, tono, duración), la velocidad del oscurecido, los umbrales de mala
postura, cuánto dura la calibración y cuánta CPU gasta la detección. Cada
sección tiene su propio «Restaurar», que nunca toca tus perfiles ni tu
calibración.

**Un botón de buscar actualizaciones**, en el icono ⓘ de arriba a la derecha.
Es la **única** conexión de red que llega a hacer la app, y solo si la pulsas
tú: nunca al arrancar, nunca en segundo plano.

## Qué descargar

| Archivo | Para qué |
|---|---|
| **`PosturePet.Setup.x.y.z.exe`** | **Instalador. Es el que quieres.** |
| `PosturePet.x.y.z.exe` | Portable, sin instalar. Solo para probar. |
| `SHA256SUMS.txt` | Hashes para verificar la descarga. |

> **Instala con el instalador, no con el portable, si quieres notificaciones.**
> Windows asocia los toasts al `AppUserModelID` mediante el acceso directo del
> menú Inicio que crea el instalador. Sin él fallan **en silencio**: la app
> parece funcionar, pero los avisos no llegan nunca.

Requisitos: Windows 10/11 x64 y una webcam. No hace falta tener Node instalado.

## Al abrirlo, Windows te va a avisar

La app **no está firmada digitalmente** — un certificado de firma cuesta
dinero y esto es un proyecto personal. SmartScreen mostrará *«Windows protegió
tu PC»*. Para continuar: **Más información** → **Ejecutar de todas formas**.

Si prefieres comprobar antes que el archivo es el que salió de este repositorio,
compara su hash con el de `SHA256SUMS.txt`:

```powershell
Get-FileHash ".\PosturePet Setup x.y.z.exe" -Algorithm SHA256
```

Los binarios los compila GitHub Actions desde el tag, no una máquina personal:
[.github/workflows/release.yml](../blob/main/.github/workflows/release.yml).

## Primer uso: calibra o no medirá nada

La app arranca en la bandeja del sistema y abre Ajustes la primera vez.

1. **Siéntate como quieres estar** el resto del día. Erguido pero cómodo, no en
   una postura de examen que no vas a mantener.
2. Pulsa **«Calibrar postura»** y quédate quieto 3 segundos.

Sin calibrar no puede puntuar nada: de frente no existe una postura «correcta»
universal, depende de tu cuerpo, tu silla y dónde tengas la webcam.

## Si algo no funciona

La primera vez que abras la cámara, Windows puede bloquearla: **Configuración →
Privacidad y seguridad → Cámara → Permitir que las aplicaciones de escritorio
accedan a la cámara**. La tabla de
[Solución de problemas](../blob/main/README.md#solución-de-problemas) del README
cubre el resto de casos.
