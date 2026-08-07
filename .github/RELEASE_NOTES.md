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

**Seis personajes para elegir**, en la pestaña nueva de Ajustes → Personaje:
Blob (el de siempre), Gato, Búho, Planta, Tortuga y Robot. La rejilla deja
probar cada estado antes de decidir, porque un personaje se elige por cómo se
ve cuando te está riñendo, no por cómo se ve quieto.

**Y ahora se les nota mucho más lo que sienten.** Tienen pupilas que miran
hacia abajo cuando te encorvas y se abren de golpe con el aviso; en postura
mala sudan, tiemblan y fruncen el ceño; y cada uno reacciona a su manera —a la
planta se le caen las hojas, el gato baja las orejas, la tortuga esconde la
cabeza en el caparazón y al robot se le enciende la antena.

**Al enderezarte, el personaje da un salto y sonríe.** Hasta ahora la app solo
sabía castigar.

**En pausa se duerme (`zZz`) y cuando pierde la cámara te busca con una `?`.**
Antes los dos estados se veían idénticos y no había forma de saber cuál era.

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
