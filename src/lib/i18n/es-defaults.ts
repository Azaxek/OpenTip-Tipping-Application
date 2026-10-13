import type { OrgType } from '../taxonomy';

/** Spanish names and descriptions for the built-in categories, in exactly the order of TAXONOMIES (tests check the lengths match). */
export const ES_CATEGORIES: Record<OrgType, [string, string][]> = {
  crime_stoppers: [
    ['Robo/Allanamiento', 'Propiedad robada, entradas forzadas, hurto en tiendas o robo de vehículos.'],
    ['Asalto con robo', 'Quitarle algo a una persona por la fuerza o con amenazas.'],
    ['Agresión', 'Alguien fue atacado físicamente o amenazado con hacerle daño.'],
    ['Homicidio', 'Un asesinato, o información sobre uno.'],
    ['Drogas/Narcóticos', 'Venta, fabricación o tráfico de drogas ilegales.'],
    ['Armas', 'Alguien tiene, vende o planea usar un arma de forma ilegal.'],
    ['Persona buscada/Prófugo', 'Sabes dónde está una persona buscada por la ley.'],
    ['Vandalismo', 'Propiedad dañada, con grafiti o destruida.'],
    ['Fraude', 'Estafas, robo de identidad, documentos falsificados o delitos financieros.'],
    ['Actividad de pandillas', 'Reclutamiento, violencia o delitos de un grupo organizado.'],
    ['Otro', 'Cualquier otra cosa que creas que la policía debe saber.'],
  ],
  campus: [
    ['Acoso/Ciberacoso', 'Conducta hiriente repetida hacia alguien, en persona o en línea.'],
    ['Peleas/Amenazas de violencia', 'Una pelea, o alguien que amenaza con lastimar a otros.'],
    ['Armas', 'Alguien tiene o planea llevar un arma a la escuela o a la comunidad.'],
    ['Drogas/Alcohol', 'Consumir, vender o llevar drogas o alcohol a la escuela.'],
    ['Autolesión/Preocupación por suicidio', 'Alguien podría hacerse daño o ha hablado de suicidio.'],
    ['Abuso (físico, sexual, negligencia)', 'Un niño o estudiante está siendo lastimado o no recibe cuidados.'],
    ['Violencia en el noviazgo/doméstica', 'Violencia, control o amenazas en una relación o en el hogar.'],
    ['Robo', 'Pertenencias o propiedad escolar robadas.'],
    ['Vandalismo', 'Daños a la propiedad escolar o a pertenencias.'],
    ['Salud mental/Bienestar', 'Alguien parece estar pasando un mal momento y le vendría bien apoyo.'],
    ['Otro', 'Cualquier otra cosa que la escuela deba saber.'],
  ],
};

const NOTE_ES = 'Un revisor responderá aquí si necesita más información, y puede tardar: esto no se monitorea en tiempo real. Vuelve más tarde o activa las notificaciones abajo. Si alguien está en peligro ahora mismo, llama al 911.';

export const ES_NOTE: Record<OrgType, string> = { crime_stoppers: NOTE_ES, campus: NOTE_ES };

export const ES_HELP: Record<OrgType, string> = {
  crime_stoppers: '¿Fuiste víctima de un delito, o alguien que conoces lo fue? Pide apoyo gratuito al programa de asistencia a víctimas de tu localidad. Si estás en peligro ahora mismo, llama al 911.',
  campus: 'Si tú o alguien que conoces está pensando en el suicidio o pasa por un momento emocional difícil, hay ayuda disponible a cualquier hora, en español: llama al 988 y oprime 2 (Línea 988 de Prevención del Suicidio y Crisis, EE. UU.), o envía el mensaje AYUDA al 988 o al 741741 (Crisis Text Line). Si alguien está en peligro inmediato, llama al 911. Tu organización puede reemplazar este texto con recursos locales.',
};
