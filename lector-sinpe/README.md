# Lector SINPE (Raspberry + módem USB + correo)

Lee los avisos de SINPE Móvil que manda el banco y los registra en la base de datos, para que el sitio
confirme los pagos solo. Tiene dos fuentes:

- **Principal: SMS.** Un módem USB con el chip al que el banco envía los avisos (`serialport`).
- **Secundaria: correo.** Una cuenta dedicada que recibe el mismo aviso del banco (`imapflow` y `mailparser`).

Cada pago se guarda con su número de comprobante. Si llegan el SMS y el correo del mismo pago, queda marcado
con las dos fuentes. Cada minuto el lector reporta que está vivo; si deja de hacerlo, el panel lo muestra en rojo.

## Antes de instalar: lo que hay que confirmar con el banco

1. Que el banco envía un SMS por cada SINPE **recibido** al número del chip que irá en el módem.
2. Que también puede enviar el aviso por correo a la cuenta dedicada (directo, o con reenvío automático).
3. Guardar 3 o 4 avisos reales de cada tipo. El formato del SMS de SINPE (remitente 7070 1222) ya está
   incluido y probado: «Ha recibido 4,500.00 Colones de NOMBRE por SINPE Movil, DESCRIPCION. Referencia ...».
   El formato del correo todavía hay que probarlo con avisos reales antes de abrir la venta.

## Instalación en el Raspberry (Raspberry Pi OS)

    # 1. Node.js 20 o superior
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs

    # 2. Usuario del servicio, con permiso para el puerto serie
    sudo adduser --disabled-password --gecos "" estufas
    sudo usermod -aG dialout estufas

    # 3. ModemManager toma el módem para sí: hay que desactivarlo
    sudo systemctl disable --now ModemManager

    # 4. Copiar la carpeta lector-sinpe a /home/estufas/lector-sinpe y, como usuario estufas:
    cd /home/estufas/lector-sinpe
    npm install --omit=dev
    cp .env.example .env && nano .env

    # 5. Encontrar el puerto del módem (use la ruta larga, no cambia al reiniciar)
    ls /dev/serial/by-id/

    # 6. Probar el módem (no borra mensajes ni toca la base de datos)
    npm run probar-modem

    # 7. Probar cómo se interpreta un aviso real
    npm run probar-parser -- "texto completo del SMS del banco"

    # 8. Arranque automático
    sudo cp lector-sinpe.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now lector-sinpe
    journalctl -u lector-sinpe -f        # ver qué está haciendo

Notas del módem: muchos módems USB muestran varios puertos (`ttyUSB0`, `ttyUSB1`, `ttyUSB2`); solo uno
responde comandos AT. Si `probar-modem` no responde, pruebe con el siguiente. Algunos modelos arrancan como
memoria USB y necesitan `usb-modeswitch` (`sudo apt install usb-modeswitch`).

## Si el banco redacta distinto: reglas.json

Copie `reglas.ejemplo.json` como `reglas.json` y escriba una regla por tipo de aviso. Cada regla tiene tres
expresiones regulares: `entrante` (texto que solo aparece en dinero recibido), `monto` y `comprobante`
(cada una con un grupo entre paréntesis para el valor). Pruebe con `npm run probar-parser`.

## Seguridad

- `SMS_REMITENTES`: acepte solo el remitente del banco. Un SMS se puede falsificar, así que no lo deje vacío.
- `IMAP_FROM_FILTER` y `IMAP_EXIGIR_DKIM=true`: solo se aceptan correos del banco con firma válida.
- `FUENTES_MINIMAS=2`: el pago solo se acepta cuando coinciden el SMS y el correo. Es lo más seguro, pero exige
  que el banco use el mismo número de comprobante en ambos avisos. Empiece en 1, confirme con avisos reales y
  suba a 2 si coinciden.
- El usuario de MongoDB del lector debe tener permiso solo sobre la base `las_estufas`.
- Deje el Raspberry en un lugar cerrado, con respaldo de energía (UPS pequeña) y sin puertos abiertos a internet.

## Qué no se ha probado todavía

El código tiene 15 pruebas automáticas (interpretación de avisos, cola de comandos del módem, conciliación de
pagos), pero se escribió sin el módem ni el banco reales. Falta probar en el Raspberry: el modelo de módem,
el formato de los SMS y correos del banco, y la reconexión tras un corte de energía o de internet.
