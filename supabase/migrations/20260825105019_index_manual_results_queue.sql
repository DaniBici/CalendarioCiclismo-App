CREATE INDEX uci_results_manual_queue_race_id_idx
  ON private.uci_results_manual_queue (race_id)
  WHERE race_id IS NOT NULL;

CREATE INDEX uci_results_manual_queue_claim_idx
  ON private.uci_results_manual_queue (status, requested_at, id)
  WHERE status IN ('pending', 'running');
