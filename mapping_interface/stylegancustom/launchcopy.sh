docker run -p 85:5000 --name styleganflasktset --gpus '"device=1"' -it -d -v /srv/Clara/stylegan2:/tmp -w /tmp styleganflask bash
