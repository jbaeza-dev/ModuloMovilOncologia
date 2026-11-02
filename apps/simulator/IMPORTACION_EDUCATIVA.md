# Publicación de material educativo

Swagger permite crear categorías, publicar imágenes y videos, publicar podcasts de
Drive y retirar episodios. Las mutaciones requieren un operador activo autenticado.
Cada acción nueva utiliza un `operacion_id` diferente; el reintento idéntico conserva
el mismo identificador. El contrato clínico externo no cambia.

El catálogo propio `GET /educacion/api/v1/podcasts` devuelve exclusivamente metadatos
educativos públicos. La app lo consulta al entrar a Educación, Podcasts o al
reproductor. La reproducción de audio y video requiere internet. Las infografías
continúan usando PowerSync y la descarga automática existente.

## Importación en el servidor

Los materiales y el manifiesto pertenecen al almacenamiento privado del servidor,
fuera del checkout. No incluirlos en imágenes de contenedor, fixtures ni Git.
Conservar los originales y un registro de fuente, checksum y resultados.

Después de compilar y aplicar las migraciones, ejecutar dentro del contenedor
clínico, con su configuración habitual:

```sh
node dist/import-education.js /ruta/privada/manifiesto.json UUID_OPERADOR --check
node dist/import-education.js /ruta/privada/manifiesto.json UUID_OPERADOR --apply
```

La utilidad requiere acceso administrativo al servidor y comprueba que el operador
exista, esté activo y corresponda al emisor configurado. No crea cuentas ni tokens.
Reutiliza los manejadores de preparación y publicación, con su auditoría,
validaciones, mantenimiento e idempotencia. No abre puertos adicionales.

Formato del manifiesto:

```json
{
  "version": 1,
  "elementos": [
    {
      "clave": "identificador-estable-del-material",
      "tipo": "imagen",
      "titulo": "Título autorizado",
      "descripcion": "Descripción breve",
      "categoria": "Categoría",
      "archivo": "material.png",
      "sha256": "CHECKSUM_SHA256_DEL_ARCHIVO"
    }
  ]
}
```

Para `video`, sustituir `archivo` y `sha256` por `url`, con formato
`https://www.youtube.com/watch?v=ID_VIDEO`. Para `podcast`, usar
`https://drive.google.com/file/d/ID_ARCHIVO/view` y habilitar el acceso público al
audio en su origen. El catálogo no descarga enlaces externos desde el backend.

`--check` valida estructura, rutas, tamaños, checksums y operador sin escribir.
Las imágenes se validan y decodifican nuevamente al publicar: PNG/JPEG, hasta
5 MiB y 8 MP. Los archivos deben estar dentro del directorio del manifiesto.
La aplicación es secuencial y registra cada resultado en
`manifiesto.json.resultado.json`. Ante un fallo, corregir su causa y repetir el
mismo manifiesto: las operaciones confirmadas no se duplican. La importación
completa no es una única transacción.

Una revisión del manifiesto genera operaciones nuevas. Para reemplazar una
publicación existente, retirar su UUID explícitamente desde Swagger; no borrar
archivos ni ejecutar un vaciado general del catálogo. Respaldar primero los datos
y archivos afectados. Las versiones anteriores de la app necesitan un APK nuevo
para consultar el catálogo de podcasts.
