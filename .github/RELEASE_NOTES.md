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

Esta versión no trae nada nuevo que mirar: arregla que la app se comiera el
equipo. Si la tenías arrancando con Windows, **actualiza**.

**Arreglada una fuga que llegaba a varios GB y decenas de procesos.** Cada vez
que un monitor se dormía o se despertaba, la capa oscurecedora registraba otra
vez sus vigilantes de pantalla sin quitar los anteriores, y el número se
**cuadruplicaba** en cada ciclo. Tras unas horas encendida, el proceso
principal se quedaba minutos enteros bloqueado reconstruyendo la capa miles de
veces. Medido antes y después, con doce ciclos de suspender y despertar:

| | antes | ahora |
|---|---|---|
| Memoria | 896 MB → 2,9 GB, sin devolverla | 945 MB, plana |
| Procesos (pico) | 87 | 8 |
| Bloqueo del proceso principal | hasta 101 s | 0 ms |

**La pausa ahora apaga la cámara de verdad.** Antes solo dejaba de *mirar* los
fotogramas: la webcam seguía encendida —con su piloto— y el detector seguía
trabajando para tirar el resultado a la basura. Ahora se suelta el dispositivo,
y Windows lo confirma en su indicador de privacidad.

**Y al reanudar ya no salta la alarma entera de golpe.** Si pausabas encorvado
y volvías media hora después, el cronómetro de permanencia seguía contando
durante la pausa: el primer fotograma disparaba oscurecimiento, aviso y sonido
a la vez. Ahora la cuenta empieza de cero al volver.

**Arreglado el error de JavaScript al cerrar la app** con la ventana de Ajustes
abierta (*«Object has been destroyed»*).

**Menos consumo en reposo:** 6 procesos y ~763 MB en vez de 8 y ~900 MB. Las
ventanas del velo oscurecedor ya no se crean al arrancar —nacen la primera vez
que hacen falta y se sueltan cuando dejan de hacerla—, la cámara captura a 15
fotogramas por segundo en vez de a 30 para analizar 4, y se han quitado un
temporizador a 20 Hz que corría en vacío y una animación que repintaba al
personaje 60 veces por segundo.

**Dos arreglos pequeños de la interfaz:** «Calibrar» desde la bandeja ya
funciona con Ajustes abierto (antes no hacía nada), y el botón de pausa de
Ajustes ya se entera cuando pausas desde la bandeja.

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
