-- La lista de suscripciones busca el último aviso de cada una:
-- sin este índice, cada carga recorre la tabla de mensajes entera.
-- CreateIndex
CREATE INDEX "ChatwootMessage_subscriptionId_createdAt_idx" ON "ChatwootMessage"("subscriptionId", "createdAt");
