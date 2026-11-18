# Archivos de la central Asterisk

| Archivo | Va en | Para qué |
| --- | --- | --- |
| `99-sim7600.rules` | `/etc/udev/rules.d/` | Nombres fijos de los puertos del módem (grupo dialout) |
| `quectel.conf.ejemplo` | `/etc/asterisk/quectel.conf` | Configuración del módem en chan_quectel |
| `extensions_custom.conf.ejemplo` | al final de `/etc/asterisk/extensions_custom.conf` | Llamadas a FreePBX y SMS al lector SINPE |

En el `.env` del lector: `SMS_FUENTE=asterisk` y el mismo `ASTERISK_TOKEN` que `SINPE_TOKEN` en
`/etc/asterisk/globals_custom.conf`. El paso a paso completo está en la guía de instalación de la central.
