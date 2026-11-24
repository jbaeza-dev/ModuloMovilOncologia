-- Los recibos de Expo actualizan el envío por su ticket; sin índice, cada recibo recorría la tabla.
CREATE INDEX gw_dispatch_provider_ticket ON gw_dispatch(provider_ticket) WHERE provider_ticket IS NOT NULL;
