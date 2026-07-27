# Sample job to exercise the extension with the demo profile: two allocations that
# log continuously (with a few "error" lines to try the cross-alloc grep).
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

      # `cores` instead of `cpu` (MHz): in VMs/Apple Silicon Nomad may report
      # CpuShares=0, and a request in MHz would never be placed.
      resources {
        cores  = 1
        memory = 32
      }
    }
  }
}
