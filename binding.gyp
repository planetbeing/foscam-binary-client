{
    "targets": [
        {
            "target_name": "FoscamG726",
            "sources": ["src/binding.cpp", "src/g72x.c", "src/g726_16.c", "src/g726.c"],
            "include_dirs" : ["<!(node -e \"require('nan')\")"]
        }
    ]
}
