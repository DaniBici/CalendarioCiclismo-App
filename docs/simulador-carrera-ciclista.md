# Simulador de carrera ciclista para Calendario Ciclismo

## Resumen

Producto integrado en web y apps de Calendario Ciclismo, gratuito de forma
permanente y con una cuenta única compartida. Combina una carrera persistente de
varias temporadas con retos breves, rankings y contenido compartible.

Es técnicamente viable. El principal condicionante deja de ser técnico: el uso
de nombres de corredores, equipos y carreras reales requiere resolver derechos
de marcas, bases de datos y activos visuales antes del lanzamiento.

## Experiencia de juego

- Crear una partida como corredor personalizado o seleccionar un ciclista real
  de la plantilla masculina WorldTour/ProTeams de 2026.
- Partir de un universo histórico fijo en 2026: cada partida evoluciona
  independientemente con resultados, fichajes, lesiones, progresión y
  rivalidades generadas por el motor.
- Modelar edad, potencial, forma, fatiga, moral, especialidad, contrato y rol de
  equipo. Los corredores se retiran por edad, rendimiento y contexto; el juego
  crea _regens_ con identidad ficticia, nacionalidad, generación, atributos y
  potencial propios para mantener vivo el pelotón.
- Simular calendario, etapas y vueltas mediante decisiones significativas de
  preparación, objetivos, táctica y recuperación; mostrar los resultados en
  formato narrativo, palmarés, clasificaciones y noticias de mercado.
- Incorporar retos cortos —fuga, sprint, abanicos, montaña, contrarreloj— con
  marcador diario/semanal y tarjeta para compartir. Usarán el mismo motor de
  atributos y táctica que el modo carrera.

## Plataforma, cuentas y datos

- Usar una identidad única de Calendario Ciclismo: un `userId` común, sesión
  sincronizada entre web y apps, guardado en nube y continuidad inmediata de las
  partidas.
- Resolver el acceso multiplataforma con un servicio de autenticación central
  compatible con navegador y apps nativas: inicio de sesión seguro, renovación
  de sesión, vinculación de dispositivo y recuperación de cuenta. La partida
  nunca dependerá únicamente del almacenamiento local.
- Separar el motor de simulación, el contenido editorial y el perfil de usuario.
  Así se podrán actualizar plantillas, calendario, eventos, _regens_ y equilibrio
  de juego sin alterar las partidas existentes.
- Mantener una base de datos propia y versionada de corredores, equipos y
  carreras 2026. Las partidas deben conservar su instantánea inicial para que
  cambios futuros de catálogo no modifiquen una carrera ya iniciada.
- Licenciar o autorizar expresamente los datos y marcas necesarios para usar
  nombres reales de equipos y carreras; no reutilizar datos, imágenes ni
  identidad visual de terceros sin derechos.

## Implementación y validación

- Construir primero el motor determinista de temporadas: una misma partida,
  estado y decisiones producen el mismo resultado; toda simulación queda trazada
  y puede auditarse.
- Crear servicios para partidas, perfiles de corredor, plantillas iniciales,
  mercado, calendario, ranking y retos; los clientes web/app consumen la misma
  API.
- Validar casos de inicio como corredor creado y real, guardado cruzado web-app,
  retiro y sustitución por _regen_, fichaje, lesión, cambio de rol y evolución de
  una plantilla durante más de diez temporadas.
- Probar equilibrio por especialidad para evitar que un perfil domine el juego;
  medir creación de partida, primera etapa completada, primera temporada
  terminada, retorno semanal y participación en retos.
- Lanzar con una beta cerrada de usuarios de Calendario Ciclismo, corregir
  retención y comprensión de las decisiones, y ampliar después calendario,
  profundidad narrativa y modalidades.
