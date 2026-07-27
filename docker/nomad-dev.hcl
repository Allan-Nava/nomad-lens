# Config for the demo profile's dev Nomad: enables the raw_exec driver so the
# sample job can run without Docker-in-Docker.
plugin "raw_exec" {
  config {
    enabled = true
  }
}
