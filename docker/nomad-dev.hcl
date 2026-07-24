# Config per il Nomad dev del profilo demo: abilita il driver raw_exec così il
# job di esempio può girare senza Docker-in-Docker.
plugin "raw_exec" {
  config {
    enabled = true
  }
}
