# Job di esempio per esercitare l'estensione col profilo demo: due allocation che
# loggano di continuo (con qualche riga "error" per provare il grep cross-alloc).
job "lens-demo" {
  datacenters = ["dc1"]
  type        = "service"

  group "web" {
    count = 2

    task "app" {
      driver = "raw_exec"

      config {
        command = "/bin/sh"
        args = [
          "-c",
          "i=0; while true; do i=$((i+1)); echo \"[$(date -u +%H:%M:%S)] lens-demo alloc up, tick=$i level=info\"; if [ $((i % 7)) -eq 0 ]; then echo \"[$(date -u +%H:%M:%S)] transient error: upstream timeout\" 1>&2; fi; sleep 3; done"
        ]
      }

      # `cores` invece di `cpu` (MHz): in VM/Apple Silicon Nomad può riportare
      # CpuShares=0, e una richiesta in MHz non verrebbe mai piazzata.
      resources {
        cores  = 1
        memory = 32
      }
    }
  }
}
