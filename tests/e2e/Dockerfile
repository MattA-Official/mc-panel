# A disposable Ubuntu 24.04 "VPS" with systemd as PID 1, for the installer smoke test.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus curl ca-certificates \
      ufw tar gzip iproute2 \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
# Host networking: keep the container's systemd away from the runner's network and consoles.
RUN systemctl mask systemd-networkd.service systemd-resolved.service systemd-logind.service \
      getty.target console-getty.service systemd-udevd.service systemd-timesyncd.service
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
