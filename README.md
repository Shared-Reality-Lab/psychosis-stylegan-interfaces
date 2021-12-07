# psychosis-stylegan-interfaces

#### Setup
Each interface needs to have a results/ folder under static to work. In addition, both style mixing and manipulation of semantics need an experiment_1/ folder under static to retrieve the selections made during the optimization. The optimization needs an originals/ folder under static containing the StyleGAN images (e.g., seed87014.png) \[0-99999] to work with the .csv maps and hotspots.json currently included in the repo.

#### Docker
Need Antoine's input on run command. /!\ mount location needs to be changed for the path to this repo
```
docker restart styleganflask<2,3>
docker stop styleganflask<2,3>
```

#### Launch
```
cd <interface_to_launch/>
python -m flask run --host=0.0.0.0
```
