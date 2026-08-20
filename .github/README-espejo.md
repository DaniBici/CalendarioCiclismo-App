# Por qué aquí no hay workflows

Este repositorio es un **espejo de solo lectura** del código de Calendario
Ciclismo. Los workflows de CI/CD (volcado de resultados, despliegue del sitio,
push programado) viven en el repositorio privado, que es el que sirve
`calendariociclismo.app` y ejecuta los crons.

Se excluyen a propósito: si se copiaran aquí, se ejecutarían **duplicados**
contra la misma base de datos de producción.

El código de la aplicación está completo. Para compilarlo necesitas tus propias
credenciales — mira los ficheros `*.template` del repositorio.
