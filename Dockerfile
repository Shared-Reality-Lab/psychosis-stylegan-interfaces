FROM tensorflow/tensorflow:1.14.0-gpu-py3

RUN pip install scipy==1.3.3
RUN pip install requests==2.22.0
RUN pip install Pillow==6.2.1
RUN pip install Flask

WORKDIR /var/avatar

# to build image:
# docker build -t styleganflask2 .

# to run:
# docker run -t -i -v $(pwd):/var/avatar -v $(pwd)/../data/originals:/var/avatar/optimization/static/originals -p 54:5000/tcp styleganflask2 bash

# for style mixing and semantics, add:
# --gpus '"device=1"' 

# and within the shell: 
#    python -m flask run --host=0.0.0.0 
